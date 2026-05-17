import { Request, Response } from "express";
import pdfParse from "pdf-parse";
import { listGeminiModels } from "../services/gemini";
import { generateQuestionsWithGemini } from "../services/gemini";
import { generateQuestionsWithOpenAI, generateQuestionsWithOpenAIPdf } from "../services/openai";
import { Course } from "../models/Course";
import { Section } from "../models/Section";
import { Quiz } from "../models/Quiz";
import { Question } from "../models/Question";
import { User } from "../models/User";
import { gradeWritingFallback, gradeWritingWithAi } from "../services/grading";
import { cloudinary } from "../config/cloudinary";
import { env } from "../config/env";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


type PracticeInput = {
  examType: "Banking" | "Insurance";
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  durationMinutes: number;
  questionsLimit: number;
};

export async function listModels(_req: Request, res: Response) {
  const models = await listGeminiModels();
  return res.json({ models });
}

// New type for section-wise generation results
type SectionGenerationResult = {
  subject: string;
  generatedCount: number;
  provider: string;
  extractedTextLength: number;
  durationMs: number;
};
export async function generatePracticeQuiz(req: Request, res: Response) {
  const { examType, topic, difficulty, durationMinutes, questionsLimit } = req.body as PracticeInput;
  const startTime = Date.now();
  const adminUser = await User.findOne({ role: "admin" }).select("_id");
  const createdBy = adminUser?._id || (req as any).user?.id;
  if (!createdBy) return res.status(400).json({ message: "Admin user not found" });

  const courseTitle = `${examType} AI Practice`;
  let course = await Course.findOne({ title: courseTitle, examType });
  if (!course) {
    course = await Course.create({
      title: courseTitle,
      examType,
      description: `AI-generated practice for ${examType} exams`,
      priceType: "free",
      status: "published",
      createdBy
    });
  }

  let section = await Section.findOne({ courseId: course._id, title: "AI Practice" });
  if (!section) {
    section = await Section.create({
      courseId: course._id,
      title: "AI Practice",
      order: 1
    });
    await Course.findByIdAndUpdate(course._id, { $push: { sections: section._id } });
  }

  const instructions = [
    `Exam: ${examType}`,
    `Topic: ${topic}`,
    `Difficulty: ${difficulty}`,
    `Target time: ${durationMinutes} minutes`,
    `Generate ${questionsLimit} multiple-choice questions with 4 options each.`,
    "Ensure questions are concise and exam-style.",
    "Return clear options and one correct answer."
  ].join("\n");

  const geminiQuestions = await generateQuestionsWithGemini({
    instructions,
    sourceText: "",
    questionsLimit
  });

  const openAiQuestions =
    geminiQuestions.length > 0
      ? []
      : await generateQuestionsWithOpenAI({
          instructions,
          sourceText: "",
          questionsLimit
        });

  const aiQuestions = geminiQuestions.length > 0 ? geminiQuestions : openAiQuestions;
  const usedAi = aiQuestions.length > 0;
  const aiProvider = geminiQuestions.length > 0 ? "gemini" : openAiQuestions.length > 0 ? "openai" : "fallback";

  const fallbackQuestions = Array.from({ length: questionsLimit }, (_, idx) => ({
    text: `${topic}: practice question ${idx + 1}?`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctOptions: [0],
    type: "single" as const,
    marks: 1,
    negativeMarks: 0,
    explanation: ""
  }));

  const generatedRaw = usedAi ? aiQuestions : fallbackQuestions;
  const generated = generatedRaw.filter(
    (q: any) => q && typeof q.text === "string" && q.text.trim() && Array.isArray(q.options) && q.options.length > 1
  );

  if (!generated.length) return res.status(400).json({ message: "No questions generated" });

  const quiz = await Quiz.create({
    sectionId: section._id,
    title: `${examType} ${topic} Practice`,
    durationMinutes,
    negativeMarking: 0,
    difficulty,
    status: "published",
    randomizeQuestions: true,
    timingMode: "aggregate",
    instructions
  });

  const docs = generated.map((g) => ({ ...g, quizId: quiz._id }));
  const inserted = await Question.insertMany(docs);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: quiz._id } });

  return res.status(201).json({
    quizId: quiz._id,
    count: inserted.length,
    usedAi,
    aiProvider,
    durationMs: Date.now() - startTime
  });
}

export async function gradeWriting(req: Request, res: Response) {
  const input = req.body as {
    essayTopic: string;
    letterTopic: string;
    essayText: string;
    letterText: string;
    essayWordCount: number;
    letterWordCount: number;
    essayTargetWords: number;
    letterTargetWords: number;
    maxEssayMarks: number;
    maxLetterMarks: number;
  };

  const aiResult = await gradeWritingWithAi(input);
  const result = aiResult || gradeWritingFallback(input);
  return res.json(result);
}

const SSC_CGL_BLUEPRINT = [
  "Exam: SSC CGL Full Length Mock",
  "Total questions: 100",
  "Total marks: 200",
  "Sections:",
  "1. Reasoning - 25 questions, +2 for correct, -0.25 for incorrect.",
  "2. Quantitative Aptitude - 25 questions, +2 for correct, -0.25 for incorrect.",
  "3. English Comprehension - 25 questions, +2 for correct, -0.25 for incorrect.",
  "4. General Awareness - 25 questions, +2 for correct, -0.25 for incorrect.",
  "Answers and worked solutions should be visible only after submission."
].join("\n");

type UploadedPdf = { buffer?: Buffer; fieldname?: string } | undefined;

async function readPdfText(file: UploadedPdf) {
  if (!file?.buffer) return "";
  const parsed = await pdfParse(file.buffer);
  return String(parsed.text || "").trim();
}

async function uploadVisualPdf(file: UploadedPdf, subject: string) {
  if (!file?.buffer || !env.cloudinaryName || !env.cloudinaryKey || !env.cloudinarySecret) {
    return "";
  }
  const dataUri = `data:application/pdf;base64,${file.buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "testbook/ssc-cgl-visuals",
    resource_type: "raw",
    public_id: `${subject.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`
  });
  return result.secure_url || "";
}

export async function previewSscCglSection(req: Request, res: Response) {
  const files = ((req as any).files || {}) as Record<string, UploadedPdf[]>;
  const subject = req.body.subject;

  if (!subject) {
    return res.status(400).json({ message: "Subject is required in the request body." });
  }

  // Map subject to the expected file key
  const keyMap: Record<string, string> = {
    "Reasoning": "reasoningPdf",
    "Quantitative Aptitude": "quantPdf",
    "English Comprehension": "englishPdf",
    "General Awareness": "gaPdf"
  };

  const expectedKey = keyMap[subject];
  // Fallback: Check specific field -> check generic 'file' field -> check first available file
  const file = (expectedKey ? files[expectedKey]?.[0] : null) || files.file?.[0] || Object.values(files).flat().filter(Boolean)[0];

  if (!file?.buffer) {
    return res.status(400).json({ message: `No PDF uploaded. Please provide a file for ${subject}.` });
  }

  // Determine if the section is visual (Reasoning and Quant are visual)
  const visual = subject === "Reasoning" || subject === "Quantitative Aptitude";

  const sourceText = await readPdfText(file);

  // If text extraction fails, return immediately so user can see the problem
  if (!sourceText || sourceText.length < 10) {
    return res.json({
      extractedTextLength: sourceText.length,
      questions: [],
      message: "Warning: Very little or no text extracted. The PDF might be an image or encrypted."
    });
  }

  // const visualPdfUrl = visual ? await uploadVisualPdf(file, subject) : "";

  const instructionsForSection = [
    `Subject: ${subject}`,
    `Blueprint: ${SSC_CGL_BLUEPRINT}`,
    `Task: Create exactly 2 ${subject} SSC CGL style multiple-choice questions for preview.`,
    "Each question must carry 2 marks and 0.25 negative marks.",
    "Format: Return a JSON array of objects. Use the uploaded PDF as the source for question, answer, and explanation."
  ].join("\n");

  let aiQuestions: any[] = [];

  // Sequential fallback for preview to stay within quota limits
  try {
    if (visual && file?.buffer) {
      aiQuestions = await generateQuestionsWithOpenAIPdf({
        instructions: instructionsForSection,
        pdfBuffer: file.buffer,
        filename: `${subject}.pdf`,
        questionsLimit: 2
      });
    }
  } catch (err) {
    console.error("OpenAI Preview Error:", err);
  }

  if (!aiQuestions.length) {
    try {
      aiQuestions = await generateQuestionsWithGemini({
        instructions: instructionsForSection,
        sourceText,
        questionsLimit: 2
      });
    } catch (err) {
      console.error("Gemini Preview Error:", err);
    }
  }

  if (!aiQuestions.length) {
    try {
      aiQuestions = await generateQuestionsWithOpenAI({
        instructions: instructionsForSection,
        sourceText,
        questionsLimit: 2
      });
    } catch (err) {
      console.error("OpenAI Text Preview Error:", err);
    }
  }

  if (!aiQuestions.length) {
    return res.status(502).json({
      message: `AI could not generate preview questions for ${subject} from the uploaded PDF.`
    });
  }

  // Take up to 2 questions
  const previewQuestions = aiQuestions.slice(0, 2).map((q: any) => ({
    text: q.text,
    options: q.options,
    correctOptions: q.correctOptions,
    explanation: q.explanation
  }));

  return res.status(200).json({
    extractedTextLength: sourceText.length,
    questions: previewQuestions
  });
}

export async function buildSscCglMock(req: Request, res: Response) {
  const startTime = Date.now();
  console.log(`[AI MOCK BUILD] Process started at ${new Date().toISOString()}`);
  const files = ((req as any).files || {}) as Record<string, UploadedPdf[]>;
  
  const sectionConfigs = [
    { subject: "Reasoning", file: files.reasoningPdf?.[0], visual: true },
    { subject: "Quantitative Aptitude", file: files.quantPdf?.[0], visual: true },
    { subject: "English Comprehension", file: files.englishPdf?.[0], visual: false },
    { subject: "General Awareness", file: files.gaPdf?.[0], visual: false }
  ];

  if (sectionConfigs.some((item) => !item.file?.buffer)) {
    return res.status(400).json({ message: "Upload one PDF for each SSC CGL section." });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  let course = await Course.findOne({ title: "SSC CGL Full Length Mocks", examType: "SSC" });
  if (!course) {
    course = await Course.create({
      title: "SSC CGL Full Length Mocks",
      examType: "SSC",
      description: "AI-generated SSC CGL full length mocks built from admin PDFs.",
      priceType: "free",
      status: "published",
      createdBy
    });
  }

  let section = await Section.findOne({ courseId: course._id, title: "Full Length Mocks" });
  if (!section) {
    section = await Section.create({ courseId: course._id, title: "Full Length Mocks", order: 1 });
    await Course.findByIdAndUpdate(course._id, { $push: { sections: section._id } });
  }

  const quiz = await Quiz.create({
    sectionId: section._id,
    title: `SSC CGL Full Length Mock - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 60,
    negativeMarking: 0.25,
    instructions: "",
    timingMode: "aggregate",
    difficulty: "medium",
    status: "draft",
    topicTags: ["SSC CGL", "Full Length Mock"],
    randomizeQuestions: false,
    showAnswersAfterSubmit: true
  });

  // Helper to process a single section with batching and fallbacks
  const processSection = async (sectionConfig: typeof sectionConfigs[0]) => {
    const sectionStart = Date.now();
    console.log(`[AI MOCK BUILD] Beginning section: ${sectionConfig.subject}`);
    
    // Read PDF text only (skip visual PDF uploads for now - will add manually later)
    const sourceText = await readPdfText(sectionConfig.file);
    
    const BATCH_SIZE = 5;
    const TARGET_COUNT = 25;
    const instructionsForSection = [
      `Subject: ${sectionConfig.subject}`,
      `Blueprint: ${SSC_CGL_BLUEPRINT}`,
      `Task: Create exactly ${BATCH_SIZE} unique ${sectionConfig.subject} SSC CGL style questions.`,
      "Each question must carry 2 marks and 0.25 negative marks.",
      "Format: Return a JSON array of objects with fields: text, options (4 strings), correctOptions (indices), explanation.",
      "Constraint: Use the uploaded PDF text/content as the source."
    ].join("\n");

    let aiQuestions: any[] = [];
    let providersUsed: string[] = [];

    // Deduplicate questions by text
    const isDuplicateQuestion = (newQ: any) => {
      return aiQuestions.some(existing => 
        existing.text?.trim().toLowerCase() === newQ.text?.trim().toLowerCase()
      );
    };

    const runBatchesSequential = async (generatorFn: Function, isVisual: boolean) => {
      const remaining = TARGET_COUNT - aiQuestions.length;
      if (remaining <= 0) return;
      const batchesNeeded = Math.ceil(remaining / BATCH_SIZE);
      
      console.log(`[AI MOCK BUILD] ${sectionConfig.subject}: Starting ${batchesNeeded} batches sequentially...`);
      
      // Run batches SEQUENTIALLY with deduplication to avoid duplicate generations
      for (let i = 0; i < batchesNeeded; i++) {
        if (aiQuestions.length >= TARGET_COUNT) break; // Stop if we have enough
        
        try {
          console.log(`[AI MOCK BUILD] ${sectionConfig.subject}: Batch ${i + 1}/${batchesNeeded} starting (${aiQuestions.length}/${TARGET_COUNT})...`);
          const batchStart = Date.now();
          
          const batch = await generatorFn({
            instructions: `${instructionsForSection}\nAlready generated: ${aiQuestions.length}. Make sure these are completely different from previous batches. Do NOT repeat similar questions.`,
            [isVisual ? "pdfBuffer" : "sourceText"]: isVisual ? sectionConfig.file?.buffer : sourceText,
            filename: isVisual ? `${sectionConfig.subject}_batch_${i}.pdf` : undefined,
            questionsLimit: BATCH_SIZE
          });
          
          if (batch && batch.length > 0) {
            // Filter out duplicates before adding
            const uniqueQuestions = batch.filter((q: any) => !isDuplicateQuestion(q));
            aiQuestions.push(...uniqueQuestions);
            console.log(`[AI MOCK BUILD] ${sectionConfig.subject}: Batch ${i + 1} finished in ${Date.now() - batchStart}ms. Added ${uniqueQuestions.length}/${batch.length}. Total: ${aiQuestions.length}/${TARGET_COUNT}`);
          }
          
          // Small delay between batches to respect rate limits
          if (i < batchesNeeded - 1 && aiQuestions.length < TARGET_COUNT) {
            await sleep(1000);
          }
        } catch (err: any) {
          console.error(`[AI BATCH ERROR] ${sectionConfig.subject} batch ${i} failed:`, err.message);
          // On error, wait before retrying
          if (err.message?.includes("429") || err.message?.toLowerCase().includes("quota")) {
            console.log(`[AI MOCK BUILD] Rate limited, waiting 5s before retry...`);
            await sleep(5000);
          }
        }
      }
    };

    // 1. OpenAI Visual PDF (for Reasoning & Quant only)
    if (sectionConfig.visual && sectionConfig.file?.buffer && aiQuestions.length < TARGET_COUNT) {
      try {
        await runBatchesSequential(generateQuestionsWithOpenAIPdf, true);
        if (aiQuestions.length > 0) providersUsed.push("openai-visual-pdf");
      } catch (err) {
        console.error(`[AI ERROR] OpenAI Visual PDF failed for ${sectionConfig.subject}:`, err);
      }
    }

    // 2. Gemini Text fallback
    if (aiQuestions.length < TARGET_COUNT) {
      try {
        await runBatchesSequential(generateQuestionsWithGemini, false);
        if (aiQuestions.length > 0) providersUsed.push("gemini");
      } catch (err) {
        console.error(`[AI ERROR] Gemini failed for ${sectionConfig.subject}:`, err);
      }
    }

    // 3. OpenAI Text fallback
    if (aiQuestions.length < TARGET_COUNT) {
      try {
        await runBatchesSequential(generateQuestionsWithOpenAI, false);
        if (aiQuestions.length > 0) providersUsed.push("openai");
      } catch (err) {
        console.error(`[AI ERROR] OpenAI Text failed for ${sectionConfig.subject}:`, err);
      }
    }

    return {
      subject: sectionConfig.subject,
      questions: aiQuestions.slice(0, 25),
      providers: providersUsed,
      sourceLength: sourceText.length,
      visualUrl: "", // Leave empty for manual editing later
      durationMs: Date.now() - sectionStart
    };
  };

  // Run sections in parallel for better performance
  const results = await Promise.all(
    sectionConfigs.map(config => processSection(config))
  );
  
  const generatedQuestions = [];
  const providerNames = new Set<string>();
  const sectionResults: SectionGenerationResult[] = [];

  for (const resData of results) {
    const { subject, questions: raw, providers, sourceLength, visualUrl, durationMs } = resData;
    
    if (!raw.length) {
      console.error(`[ERROR] ${subject} generation failed. Text length: ${sourceLength}`);
      await Quiz.findByIdAndDelete(quiz._id);
      return res.status(502).json({ 
        message: `Failed to generate questions for ${subject}.`,
        sectionResults 
      });
    }

    providers.forEach(p => providerNames.add(p));
    sectionResults.push({
      subject,
      generatedCount: raw.length,
      provider: providers.join(", "),
      extractedTextLength: sourceLength,
      durationMs
    });

    generatedQuestions.push(
      ...raw.map((question: any) => ({
        ...question,
        subject,
        quizId: quiz._id,
        marks: 2,
        negativeMarks: 0.25,
        visualPdfUrl: "", // Leave empty for manual editing
        visualPageNumber: undefined,
        visualNote: "" // Leave empty for manual editing
      }))
    );
  }

  const inserted = await Question.insertMany(generatedQuestions);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: quiz._id } });

  const totalDurationMs = Date.now() - startTime;
  console.log(`[AI MOCK BUILD] Completed successfully in ${Math.round(totalDurationMs / 1000)}s`);

  return res.status(201).json({
    quizId: quiz._id,
    questionCount: inserted.length,
    providers: Array.from(providerNames),
    sectionResults: sectionResults,
    totalDurationMs
  });
}

export async function getLatestPublishedSscCglMock(_req: Request, res: Response) {
  const quiz = await Quiz.findOne({
    status: "published",
    topicTags: { $in: ["SSC CGL", "Full Length Mock"] }
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select("_id title durationMinutes difficulty instructions");
  return res.json({ quiz });
}

export async function getAllPublishedSscCglMocks(_req: Request, res: Response) {
  const mocks = await Quiz.find({
    status: "published",
    topicTags: { $in: ["SSC CGL", "Full Length Mock"] }
  })
    .sort({ createdAt: -1 })
    .select("_id title durationMinutes difficulty instructions")
    .lean();
  return res.json({ mocks: mocks || [] });
}

export async function generateSectionQuiz(req: Request, res: Response) {
  const startTime = Date.now();
  const file = (req as any).file as { buffer?: Buffer } | undefined;
  const { subject, courseId } = req.body;

  if (!subject || !file?.buffer) {
    return res.status(400).json({ message: "Subject and PDF file are required" });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  // Create or get course
  let course = await Course.findOne({ title: "SSC CGL Section Quizzes", examType: "SSC" });
  if (!course) {
    course = await Course.create({
      title: "SSC CGL Section Quizzes",
      examType: "SSC",
      description: "Section-wise SSC CGL quizzes for admin building",
      priceType: "free",
      status: "draft",
      createdBy
    });
  }

  // Create or get section
  let section = await Section.findOne({ courseId: course._id, title: "Section Quizzes" });
  if (!section) {
    section = await Section.create({ courseId: course._id, title: "Section Quizzes", order: 1 });
    await Course.findByIdAndUpdate(course._id, { $push: { sections: section._id } });
  }

  // Create quiz
  const quiz = await Quiz.create({
    sectionId: section._id,
    title: `${subject} - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 15,
    negativeMarking: 0.25,
    instructions: `${subject} Section - 25 Questions`,
    timingMode: "aggregate",
    difficulty: "medium",
    status: "draft",
    topicTags: ["SSC CGL", "Section", subject],
    randomizeQuestions: false,
    showAnswersAfterSubmit: true
  });

  const sourceText = await readPdfText(file);
  if (!sourceText || sourceText.length < 10) {
    await Quiz.findByIdAndDelete(quiz._id);
    return res.status(400).json({ message: "PDF text extraction failed" });
  }

  const instructionsForSection = [
    `Subject: ${subject}`,
    `Blueprint: ${SSC_CGL_BLUEPRINT}`,
    `Task: Create exactly 25 unique ${subject} SSC CGL style questions.`,
    "Each question must carry 2 marks and 0.25 negative marks.",
    "Format: Return a JSON array with fields: text, options (4 strings), correctOptions (indices), explanation.",
    "Constraint: Use the uploaded PDF as source."
  ].join("\n");

  let aiQuestions: any[] = [];
  let providersUsed: string[] = [];

  const isDuplicateQuestion = (newQ: any) => {
    return aiQuestions.some(
      (existing) => existing.text?.trim().toLowerCase() === newQ.text?.trim().toLowerCase()
    );
  };

  const runBatchesSequential = async (generatorFn: Function, isVisual: boolean) => {
    const remaining = 25 - aiQuestions.length;
    if (remaining <= 0) return;
    const BATCH_SIZE = 5;
    const batchesNeeded = Math.ceil(remaining / BATCH_SIZE);

    for (let i = 0; i < batchesNeeded; i++) {
      if (aiQuestions.length >= 25) break;
      try {
        const batch = await generatorFn({
          instructions: `${instructionsForSection}\nAlready generated: ${aiQuestions.length}. Make sure these are completely different from previous batches. Do NOT repeat similar questions.`,
          [isVisual ? "pdfBuffer" : "sourceText"]: isVisual ? file.buffer : sourceText,
          filename: isVisual ? `${subject}_batch_${i}.pdf` : undefined,
          questionsLimit: BATCH_SIZE
        });

        if (batch && batch.length > 0) {
          const uniqueQuestions = batch.filter((q: any) => !isDuplicateQuestion(q));
          aiQuestions.push(...uniqueQuestions);
        }

        if (i < batchesNeeded - 1 && aiQuestions.length < 25) await sleep(1000);
      } catch (err: any) {
        console.error(`[AI SECTION ERROR] ${subject} batch ${i} failed:`, err.message);
        if (err.message?.includes("429") || err.message?.toLowerCase().includes("quota")) {
          await sleep(5000);
        }
      }
    }
  };

  // Try providers in order
  try {
    await runBatchesSequential(generateQuestionsWithOpenAIPdf, true);
    if (aiQuestions.length > 0) providersUsed.push("openai-visual-pdf");
  } catch (err) {
    console.error(`[AI ERROR] OpenAI Visual PDF failed for ${subject}:`, err);
  }

  if (aiQuestions.length < 25) {
    try {
      await runBatchesSequential(generateQuestionsWithGemini, false);
      if (aiQuestions.length > 0) providersUsed.push("gemini");
    } catch (err) {
      console.error(`[AI ERROR] Gemini failed for ${subject}:`, err);
    }
  }

  if (aiQuestions.length < 25) {
    try {
      await runBatchesSequential(generateQuestionsWithOpenAI, false);
      if (aiQuestions.length > 0) providersUsed.push("openai");
    } catch (err) {
      console.error(`[AI ERROR] OpenAI Text failed for ${subject}:`, err);
    }
  }

  if (aiQuestions.length === 0) {
    await Quiz.findByIdAndDelete(quiz._id);
    return res.status(502).json({ message: `Failed to generate questions for ${subject}` });
  }

  const generatedQuestions = aiQuestions.slice(0, 25).map((q: any) => ({
    ...q,
    subject,
    quizId: quiz._id,
    marks: 2,
    negativeMarks: 0.25,
    visualPdfUrl: "",
    visualPageNumber: undefined,
    visualNote: ""
  }));

  const inserted = await Question.insertMany(generatedQuestions);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: quiz._id } });

  const totalDurationMs = Date.now() - startTime;
  console.log(`[AI SECTION QUIZ] ${subject} completed in ${Math.round(totalDurationMs / 1000)}s`);

  return res.status(201).json({
    quizId: quiz._id,
    subject,
    questionCount: inserted.length,
    providers: providersUsed,
    durationMs: totalDurationMs
  });
}

export async function combineSectionQuizzes(req: Request, res: Response) {
  const { sectionQuizIds } = req.body;

  if (!Array.isArray(sectionQuizIds) || sectionQuizIds.length !== 4) {
    return res.status(400).json({ message: "Exactly 4 section quiz IDs are required" });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  // Get all section quizzes
  const sectionQuizzes = await Quiz.find({ _id: { $in: sectionQuizIds } }).populate("questions");
  if (sectionQuizzes.length !== 4) {
    return res.status(400).json({ message: "Not all section quizzes found" });
  }

  // Create full mock
  let course = await Course.findOne({ title: "SSC CGL Full Length Mocks", examType: "SSC" });
  if (!course) {
    course = await Course.create({
      title: "SSC CGL Full Length Mocks",
      examType: "SSC",
      description: "Combined SSC CGL full length mocks",
      priceType: "free",
      status: "published",
      createdBy
    });
  }

  let section = await Section.findOne({ courseId: course._id, title: "Full Length Mocks" });
  if (!section) {
    section = await Section.create({ courseId: course._id, title: "Full Length Mocks", order: 1 });
    await Course.findByIdAndUpdate(course._id, { $push: { sections: section._id } });
  }

  const fullMockQuiz = await Quiz.create({
    sectionId: section._id,
    title: `SSC CGL Full Length Mock - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 60,
    negativeMarking: 0.25,
    instructions: "SSC CGL Full Length Mock - 100 Questions",
    timingMode: "aggregate",
    difficulty: "medium",
    status: "draft",
    topicTags: ["SSC CGL", "Full Length Mock"],
    randomizeQuestions: false,
    showAnswersAfterSubmit: true,
    sectionTimeMinutes: 15
  });

  // Combine all questions
  const allQuestionIds: any[] = [];
  sectionQuizzes.forEach((q) => {
    allQuestionIds.push(...(q.questions || []));
  });

  // Ensure every combined Question has subject set (used by SeriousMockTest mapping)
  const subjectBySectionTitle = (title: string) => {
    const t = String(title || "").trim();
    const tl = t.toLowerCase();

    // Prefer exact/label starts (matches how section quizzes are created in generateSectionQuiz())
    if (t.startsWith("Reasoning")) return "Reasoning";
    if (t.startsWith("Quantitative Aptitude")) return "Quantitative Aptitude";
    if (t.startsWith("English Comprehension")) return "English Comprehension";
    if (t.startsWith("General Awareness")) return "General Awareness";

    // Fallback: keyword contains
    if (tl.includes("reasoning")) return "Reasoning";
    if (tl.includes("quant")) return "Quantitative Aptitude";
    if (tl.includes("english")) return "English Comprehension";
    if (tl.includes("general") || tl.includes("awareness")) return "General Awareness";

    return "";
  };

  // Build a map: questionId -> subject
  const questionIdToSubject = new Map<string, string>();
  for (const sq of sectionQuizzes) {
    const subject = subjectBySectionTitle(sq.title);
    for (const qq of sq.questions || []) {
      questionIdToSubject.set(String(qq._id), subject);
    }
  }

  // Patch missing/empty subjects
  const subjectUpdates = Array.from(questionIdToSubject.entries()).filter(([, subject]) => Boolean(subject));
  if (subjectUpdates.length > 0) {
    await Promise.all(
      subjectUpdates.map(([questionId, subject]) =>
        Question.findByIdAndUpdate(questionId, { subject })
      )
    );
  }


  await Quiz.findByIdAndUpdate(fullMockQuiz._id, { $push: { questions: { $each: allQuestionIds } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: fullMockQuiz._id } });

  return res.status(201).json({
    fullMockQuizId: fullMockQuiz._id,
    sectionQuizzes: sectionQuizzes.map((q) => ({ _id: q._id, title: q.title, questionCount: q.questions?.length || 0 })),
    totalQuestionCount: allQuestionIds.length
  });
}
