import { Request, Response } from "express";
import pdfParse from "pdf-parse";
import { detectHtmlAndExtractQuestions } from "../utils/sscCglHtmlParser";

import { listGeminiModels, translateQuestionToHindi as translateWithGemini } from "../services/gemini";

import { generateQuestionsWithGemini } from "../services/gemini";
import { generateQuestionsWithOpenAI, generateQuestionsWithOpenAIPdf, translateQuestionToHindi as translateWithOpenAI } from "../services/openai";
import { Course } from "../models/Course";
import { Section } from "../models/Section";
import { Quiz } from "../models/Quiz";
import { Question } from "../models/Question";
import { User } from "../models/User";
import { gradeWritingFallback, gradeWritingWithAi } from "../services/grading";
import { cloudinary } from "../config/cloudinary";
import { env } from "../config/env";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Global progress tracker for real-time updates
const translationProgressMap = new Map<string, {
  total: number;
  completed: number;
  percentage: number;
  startTime: number;
  status: 'in_progress' | 'completed' | 'failed';
  error?: string;
}>();


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

// Get translation progress in real-time
export async function getTranslationProgress(req: Request, res: Response) {
  const { progressId } = req.params;

  if (!progressId) {
    return res.status(400).json({ message: "progressId is required" });
  }

  const progress = translationProgressMap.get(progressId);

  if (!progress) {
    return res.status(404).json({ message: "Progress not found or expired" });
  }

  return res.json({
    progressId,
    ...progress,
    elapsedMs: Date.now() - progress.startTime
  });
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
  "1. Reasoning - 25 questions, +2 for correct, -0.5 for incorrect.",
  "2. Quantitative Aptitude - 25 questions, +2 for correct, -0.5 for incorrect.",
  "3. English Comprehension - 25 questions, +2 for correct, -0.5 for incorrect.",
  "4. General Awareness - 25 questions, +2 for correct, -0.5 for incorrect.",
  "Answers and worked solutions should be visible only after submission."
].join("\n");

type UploadedPdf = { buffer?: Buffer; fieldname?: string } | undefined;

function manualExtractFromText(text: string) {
  // Simple regex to find questions ending with '?' or starting with a number.
  const questionRegex = /(?:\d+[\.\)]\s+)?([\s\S]*?\?)/g;
  const matches = text.match(questionRegex) || [];
  return matches.map(q => ({
    // Ensure text is never empty, as Mongoose schema requires it.
    // If q.trim() is empty, provide a default.
    text: q.trim() || "Question text could not be extracted from PDF.",
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctOptions: [0],
    explanation: "Manual extraction complete."
  }));
}

async function readPdfText(file: UploadedPdf) {
  if (!file?.buffer) return "";
  
  // Check if content looks like HTML (improved detection)
  const contentPrefix = file.buffer.slice(0, 500).toString('utf-8').trim().toLowerCase();
  if (contentPrefix.includes('<html') || contentPrefix.includes('<!doctype') || contentPrefix.includes('<body') || contentPrefix.includes('<div')) {
    return file.buffer.toString('utf-8').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
  }

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
  const files = ((req as any).files || {}) as Record<string, any[]>;
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
  const file = (expectedKey ? files[expectedKey]?.[0] : null) || (req as any).file || files.file?.[0] || Object.values(files).flat().filter(Boolean)[0];

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

  // MANUAL PARSING (Strictly no AI as requested)
  let parsed: any[] = [];
  const contentPrefix = file.buffer.slice(0, 500).toString('utf-8').trim().toLowerCase();
  const isHtml = contentPrefix.includes('<html') || contentPrefix.includes('<!doctype') || contentPrefix.includes('<body') || contentPrefix.includes('<div');

  if (isHtml) {
    parsed = detectHtmlAndExtractQuestions(file.buffer) || [];
  } else {
    parsed = manualExtractFromText(sourceText);
  }

  // Take up to 2 questions for preview
  const previewQuestions = parsed.slice(0, 2).map((q: any) => ({
    text: q.text,
    text_hi: q.text_hi || "",
    options: q.options || ["Option A", "Option B", "Option C", "Option D"],
    options_hi: q.options_hi || [],
    correctOptions: q.correctOptions || [0],
    explanation: q.explanation || "Extracted manually.",
    explanation_hi: q.explanation_hi || ""
  }));

  return res.status(200).json({
    extractedTextLength: sourceText.length,
    questions: previewQuestions.length > 0 ? previewQuestions : []
  });
}

export async function buildSscCglMock(req: Request, res: Response) {
  const startTime = Date.now();
  console.log(`[AI MOCK BUILD] Process started at ${new Date().toISOString()}`);
  const { title: customTitle } = req.body;
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
    title: customTitle || `SSC CGL Full Length Mock - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 60,
    negativeMarking: 0.5,
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
      "Each question must carry 2 marks and 0.5 negative marks. All content must be bilingual.",
      "Format: Return a JSON array of objects with fields: text, text_hi, options (4 strings), options_hi (4 strings), correctOptions (indices), explanation, explanation_hi.",
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
        negativeMarks: 0.5,
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
    .select("_id title durationMinutes difficulty instructions language questions")
    .lean();
  return res.json({ mocks: mocks || [] });
}

export async function generateSectionQuiz(req: Request, res: Response) {

  const startTime = Date.now();
  const files = ((req as any).files || {}) as Record<string, any[]>;
  const file = (req as any).file || files.file?.[0] || Object.values(files).flat().filter(Boolean)[0];
  const { subject, courseId } = req.body;

  if (!subject || !file?.buffer) {
    return res.status(400).json({ message: "Subject and file are required" });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  // Create or get course
  const courseTitle = "SSC CGL Section Quizzes";
  let course = await Course.findOne({ title: courseTitle, examType: "SSC" });
  if (!course) {
    course = await Course.create({
      title: courseTitle,
      examType: "SSC",
      description: "Section-wise SSC CGL quizzes for admin building",
      priceType: "free",
      status: "published",
      createdBy
    });
  }

  // Create or get section
  let section = await Section.findOne({ courseId: course._id, title: "Section Quizzes" });
  if (!section) {
    section = await Section.create({ courseId: course._id, title: "Section Quizzes", order: 1 });
    await Course.findByIdAndUpdate(course._id, { $push: { sections: section._id } });
  }

  const isHindi = subject.includes("(HI)") || subject.includes("[हिन्दी]");

  // Create quiz
  const quiz = await Quiz.create({
    sectionId: section._id,
    title: `${subject} - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 15,
    negativeMarking: 0.5,
    instructions: `${subject} Section - 25 Questions ${isHindi ? '(हिन्दी)' : ''}`,
    timingMode: "aggregate",
    difficulty: "medium",
    status: "published",
    topicTags: ["SSC CGL", "Section", subject],
    randomizeQuestions: false,
    showAnswersAfterSubmit: true,
    language: isHindi ? "hi" : "en"
  });

  let parsed: any[] = [];
  const contentPrefix = file.buffer.slice(0, 500).toString('utf-8').trim().toLowerCase();
  const isHtml = contentPrefix.includes('<html') || contentPrefix.includes('<!doctype') || contentPrefix.includes('<body') || contentPrefix.includes('<div');

  if (isHtml) {
    parsed = detectHtmlAndExtractQuestions(file.buffer) || [];
  } else {
    const sourceText = await readPdfText(file);
    parsed = manualExtractFromText(sourceText);
  }

  if (!parsed || parsed.length === 0) {
    await Quiz.findByIdAndDelete(quiz._id);
    return res.status(400).json({ message: "No questions could be manually parsed from the file." });
  }

  const targetCount = 25;
  const questionsBase = parsed.slice(0, targetCount);

  // Pad to exactly 25 questions to maintain index-based sectioning in the UI
  const padded = [...questionsBase];
  while (padded.length < targetCount) {
    const idx = padded.length + 1;
    padded.push({
      subject,
      text: `${subject}: Practice Question ${idx}?`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctOptions: [0],
      explanation: "",
      type: "single",
      marks: 2,
      negativeMarks: 0.5
    });
  }

  const generatedQuestions = padded.map((q: any) => {
    const isHI = isHindi;
    return {
      ...q,
      type: q.type || "single",
      subject,
      quizId: quiz._id,
      marks: q.marks ?? 2,
      negativeMarks: q.negativeMarks ?? 0.5,
      visualPdfUrl: "",
      visualPageNumber: undefined,
      visualNote: "",
      language: isHI ? "hi" : "en",
      // Populate Hindi fields for the test player to show content in Hindi mode
      text_hi: isHI ? (q.text_hi || q.text || "") : (q.text_hi || ""),
      options_hi: isHI ? (q.options_hi || q.options || []) : (q.options_hi || []),
      explanation_hi: isHI ? (q.explanation_hi || q.explanation || "") : (q.explanation_hi || ""),
      // Keep the original text field as Hindi if it's a Hindi mock (fallback)
      text: q.text || ""
    };
  });

  const inserted = await Question.insertMany(generatedQuestions);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: quiz._id } });

  const totalDurationMs = Date.now() - startTime;
  console.log(`[MANUAL SECTION QUIZ] ${subject} completed in ${Math.round(totalDurationMs / 1000)}s`);

  return res.status(201).json({
    quizId: quiz._id,
    subject,
    questionCount: inserted.length,
    providers: ["manual-parser"],
    durationMs: totalDurationMs
  });
}

async function translateToHindi(text: string) {
  try {
    if (!env.geminiApiKey && !env.openaiApiKey) return text;

    const prompt = [
      "Translate the following SSC CGL English text into Hindi.",
      "Return ONLY the translated Hindi text, no quotes.",
      text
    ].join("\n");

    if (env.geminiApiKey) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        }
      );
      const data = (await res.json().catch(() => ({}))) as any;
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || text;
    }

    if (env.openaiApiKey) {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openaiApiKey}`
        },
        body: JSON.stringify({
          model: env.openaiModel,
          input: prompt
        })
      });
      const data = (await res.json().catch(() => ({}))) as any;
      return data?.output?.[0]?.content?.[0]?.text || text;
    }
  } catch {
    // ignore
  }
  return text;
}

export async function generateSectionQuizFromHtml(req: Request, res: Response) {
  const startTime = Date.now();
  const file = (req as any).file as { buffer?: Buffer; originalname?: string } | undefined;
  const { subject } = req.body;

  if (!subject) {
    return res.status(400).json({ message: "subject is required" });
  }
  if (!file?.buffer) {
    return res.status(400).json({ message: "file is required" });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  const parsed = detectHtmlAndExtractQuestions(file.buffer);
  if (!parsed || parsed.length === 0) {
    return res.status(400).json({ message: "No questions found in uploaded HTML" });
  }

  // Create or get course/section/quiz (same structure as generateSectionQuiz)
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

  let section = await Section.findOne({ courseId: course._id, title: "Section Quizzes" });
  if (!section) {
    section = await Section.create({ courseId: course._id, title: "Section Quizzes", order: 1 });
    await Course.findByIdAndUpdate(course._id, { $push: { sections: section._id } });
  }

  const quiz = await Quiz.create({
    sectionId: section._id,
    title: `${subject} (HTML) - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 15,
    negativeMarking: 0.5,
    instructions: `${subject} Section - ${parsed.length} Questions (HTML)` ,
    timingMode: "aggregate",
    difficulty: "medium",
    status: "draft",
    topicTags: ["SSC CGL", "Section", subject],
    randomizeQuestions: false,
    showAnswersAfterSubmit: true,
    sectionTimeMinutes: 15
  });

  // Ensure 25 questions like the rest of the pipeline.
  const targetCount = 25;
  const questionsBase = parsed.slice(0, targetCount);

  // If less than targetCount, pad with fallback questions (so UI/serious mock expects 25).
  const padded = [...questionsBase];
  while (padded.length < targetCount) {
    const idx = padded.length + 1;
    padded.push({
      subject,
      text: `${subject}: HTML practice question ${idx}?`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctOptions: [0],
      explanation: ""
    });
  }

  const questionsToInsert: any[] = [];
  for (const q of padded) {
    const text_hi = await translateToHindi(q.text);
    const options_hi = await Promise.all((q.options || []).slice(0, 4).map((opt) => translateToHindi(opt)));
    const explanation_hi = q.explanation ? await translateToHindi(q.explanation) : "";

    questionsToInsert.push({
      ...q,
      type: "single",
      marks: 2,
      negativeMarks: 0.5,
      subject,
      quizId: quiz._id,
      // store image URL if present
      imageUrl: (q as any).imageUrl || "",
      text_hi,
      options_hi,
      explanation_hi
    });
  }

  const inserted = await Question.insertMany(questionsToInsert);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: quiz._id } });

  return res.status(201).json({
    quizId: quiz._id,
    subject,
    questionCount: inserted.length,
    providers: ["html-parser"],
    durationMs: Date.now() - startTime
  });
}

export async function combineSectionQuizzes(req: Request, res: Response) {


  const { sectionQuizIds, enQuizIds, hiQuizIds, title: customTitle } = req.body;

  const isBilingual = Array.isArray(enQuizIds) && Array.isArray(hiQuizIds);
  const expectedCount = isBilingual ? 8 : 4;

  let allQuizIds: string[] = [];
  if (isBilingual) {
    allQuizIds = [...enQuizIds, ...hiQuizIds];
  } else if (Array.isArray(sectionQuizIds)) {
    allQuizIds = sectionQuizIds;
  }

  if (allQuizIds.length !== expectedCount) {
    return res.status(400).json({ message: `Exactly ${expectedCount} section quiz IDs are required` });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  // Get all section quizzes and explicitly preserve the order provided in the request
  const docs = await Quiz.find({ _id: { $in: allQuizIds } }).populate("questions");
  const sectionQuizzes = allQuizIds
    .map(id => docs.find(d => d._id.toString() === id.toString()))
    .filter((q): q is any => !!q);

  if (sectionQuizzes.length !== expectedCount) {
    return res.status(400).json({ message: `Not all section quizzes found (expected ${expectedCount}, got ${sectionQuizzes.length})` });
  }

  // Helper to ensure subjects are correctly set for UI grouping
  const subjectBySectionTitle = (title: string) => {
    const t = String(title || "").trim().toLowerCase();
    if (t.includes("reasoning")) return "Reasoning";
    if (t.includes("quant")) return "Quantitative Aptitude";
    if (t.includes("english")) return "English Comprehension";
    if (t.includes("general") || t.includes("awareness") || t.includes("gk") || t.includes("ga")) return "General Awareness";
    return "";
  };

  const patchSubjects = async (quizzes: any[]) => {
    const updates: Promise<any>[] = [];
    for (const sq of quizzes) {
      const subject = subjectBySectionTitle(sq.title);
      if (!subject) continue;
      for (const q of sq.questions || []) {
        updates.push(Question.findByIdAndUpdate(q._id, { subject }));
      }
    }
    await Promise.all(updates);
  };

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

  if (isBilingual) {
    // Create bilingual full mock with both EN and HI versions
    const enQuizzes = sectionQuizzes.filter((q, idx) => idx < 4); // First 4 are EN
    const hiQuizzes = sectionQuizzes.filter((q, idx) => idx >= 4); // Last 4 are HI

    // Create English full mock
    const enFullMockQuiz = await Quiz.create({
      sectionId: section._id,
      title: customTitle || `SSC CGL Full Length Mock - ${new Date().toLocaleDateString("en-IN")}`,
      durationMinutes: 60,
      negativeMarking: 0.5,
      instructions: "SSC CGL Full Length Mock - 100 Questions (English)",
      timingMode: "aggregate",
      difficulty: "medium",
      status: "draft",
      topicTags: ["SSC CGL", "Full Length Mock"],
      randomizeQuestions: false,
      showAnswersAfterSubmit: true,
      sectionTimeMinutes: 15,
      language: "en"
    });

    // Combine EN questions
    const enQuestionIds: any[] = [];
    enQuizzes.forEach((q) => {
      enQuestionIds.push(...(q.questions || []));
    });

    await patchSubjects(enQuizzes);
    await Quiz.findByIdAndUpdate(enFullMockQuiz._id, { $push: { questions: { $each: enQuestionIds } } });
    await Section.findByIdAndUpdate(section._id, { $push: { quizzes: enFullMockQuiz._id } });

    // Create Hindi full mock
    const hiFullMockQuiz = await Quiz.create({
      sectionId: section._id,
      title: customTitle ? `${customTitle} [हिन्दी]` : `SSC CGL Full Length Mock [हिन्दी] - ${new Date().toLocaleDateString("en-IN")}`,
      durationMinutes: 60,
      negativeMarking: 0.5,
      instructions: "SSC CGL Full Length Mock - 100 Questions (हिन्दी में)",
      timingMode: "aggregate",
      difficulty: "medium",
      status: "draft",
      topicTags: ["SSC CGL", "Full Length Mock"],
      randomizeQuestions: false,
      showAnswersAfterSubmit: true,
      sectionTimeMinutes: 15,
      language: "hi",
      translatedFromQuizId: enFullMockQuiz._id
    });

    // Combine HI questions
    const hiQuestionIds: any[] = [];
    hiQuizzes.forEach((q) => {
      hiQuestionIds.push(...(q.questions || []));
    });

    await patchSubjects(hiQuizzes);
    await Quiz.findByIdAndUpdate(hiFullMockQuiz._id, { $push: { questions: { $each: hiQuestionIds } } });
    await Section.findByIdAndUpdate(section._id, { $push: { quizzes: hiFullMockQuiz._id } });

    return res.status(201).json({
      fullMockQuizId: enFullMockQuiz._id,
      hiFullMockQuizId: hiFullMockQuiz._id,
      sectionQuizzes: sectionQuizzes.map((q) => ({ _id: q._id, title: q.title, questionCount: q.questions?.length || 0 })),
      totalQuestionCount: enQuestionIds.length + hiQuestionIds.length
    });
  } else {
    // Legacy mode: create single full mock from 4 EN quizzes
    const fullMockQuiz = await Quiz.create({
      sectionId: section._id,
      title: customTitle || `SSC CGL Full Length Mock - ${new Date().toLocaleDateString("en-IN")}`,
      durationMinutes: 60,
      negativeMarking: 0.5,
      instructions: "SSC CGL Full Length Mock - 100 Questions",
      timingMode: "aggregate",
      difficulty: "medium",
      status: "draft",
      topicTags: ["SSC CGL", "Full Length Mock"],
      randomizeQuestions: false,
      showAnswersAfterSubmit: true,
      sectionTimeMinutes: 15,
      language: "en"
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
      if (tl.includes("general") || tl.includes("awareness") || tl.includes("gk") || tl.includes("ga")) return "General Awareness";

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

    // Create Hindi version of full mock if all section translations exist
    let hiFullMockQuizId: string | null = null;
    const hiSectionQuizzes = await Promise.all(
      allQuizIds.map((id) => Quiz.findOne({ translatedFromQuizId: id, language: "hi" }))
    );

    if (hiSectionQuizzes.every(Boolean)) {
      const hiFullMockQuiz = await Quiz.create({
        sectionId: section._id,
        title: customTitle ? `${customTitle} [हिन्दी]` : `SSC CGL Full Length Mock [हिन्दी] - ${new Date().toLocaleDateString("en-IN")}`,
        durationMinutes: 60,
        negativeMarking: 0.5,
        instructions: "SSC CGL Full Length Mock - 100 Questions (हिन्दी में)",
        timingMode: "aggregate",
        difficulty: "medium",
        status: "draft",
        topicTags: ["SSC CGL", "Full Length Mock"],
        randomizeQuestions: false,
        showAnswersAfterSubmit: true,
        sectionTimeMinutes: 15,
        language: "hi",
        translatedFromQuizId: fullMockQuiz._id
      });

      // Combine Hindi questions
      const allHiQuestionIds: any[] = [];
      for (const hiQuiz of hiSectionQuizzes.filter(Boolean)) {
        allHiQuestionIds.push(...(hiQuiz!.questions || []));
      }

      await Quiz.findByIdAndUpdate(hiFullMockQuiz._id, { $push: { questions: { $each: allHiQuestionIds } } });
      await Section.findByIdAndUpdate(section._id, { $push: { quizzes: hiFullMockQuiz._id } });
      hiFullMockQuizId = String(hiFullMockQuiz._id);
    }

    return res.status(201).json({
      fullMockQuizId: fullMockQuiz._id,
      hiFullMockQuizId,
      sectionQuizzes: sectionQuizzes.map((q) => ({ _id: q._id, title: q.title, questionCount: q.questions?.length || 0 })),
      totalQuestionCount: allQuestionIds.length
    });
  }
}

export async function translateSectionQuiz(req: Request, res: Response) {
  const startTime = Date.now();
  const { quizId } = req.body;

  if (!quizId) {
    return res.status(400).json({ message: "quizId is required" });
  }

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  // Create a unique progress ID for this translation session
  const progressId = `${quizId}-${Date.now()}`;
  
  // Initialize progress tracker
  translationProgressMap.set(progressId, {
    total: 0,
    completed: 0,
    percentage: 0,
    startTime,
    status: 'in_progress'
  });

  try {
    // Fetch the English quiz with questions
    const enQuiz = await Quiz.findById(quizId).populate("questions");
    if (!enQuiz) {
      translationProgressMap.delete(progressId);
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (enQuiz.language !== "en") {
      translationProgressMap.delete(progressId);
      return res.status(400).json({ message: "Only English quizzes can be translated" });
    }

    // Get the section to create Hindi quiz under same section
    const section = await Section.findById(enQuiz.sectionId);
    if (!section) {
      translationProgressMap.delete(progressId);
      return res.status(400).json({ message: "Section not found" });
    }

    // ✅ Idempotency: if a Hindi quiz already exists for this English quiz, return it.
    const existingHiQuiz = await Quiz.findOne({
      sectionId: enQuiz.sectionId,
      translatedFromQuizId: enQuiz._id,
      language: "hi"
    }).populate("questions");

    if (existingHiQuiz) {
      const existingQuestionsCount = (existingHiQuiz.questions || []).length;

      translationProgressMap.set(progressId, {
        total: existingQuestionsCount,
        completed: existingQuestionsCount,
        percentage: 100,
        startTime,
        status: 'completed'
      });

      return res.status(201).json({
        progressId,
        hiQuizId: existingHiQuiz._id,
        enQuizId: enQuiz._id,
        questionCount: existingQuestionsCount,
        durationMs: Date.now() - startTime,
        progress: {
          total: existingQuestionsCount,
          completed: existingQuestionsCount,
          percentage: 100
        }
      });
    }

    // Create Hindi quiz (copy of English quiz with language=hi)
    const hiQuiz = await Quiz.create({
      sectionId: enQuiz.sectionId,
      title: `${enQuiz.title} [हिन्दी]`,
      durationMinutes: enQuiz.durationMinutes,
      negativeMarking: enQuiz.negativeMarking,
      instructions: enQuiz.instructions,
      timingMode: enQuiz.timingMode,
      sectionTimeMinutes: enQuiz.sectionTimeMinutes,
      difficulty: enQuiz.difficulty,
      topicTags: enQuiz.topicTags,
      status: "draft",
      randomizeQuestions: enQuiz.randomizeQuestions,
      showAnswersAfterSubmit: enQuiz.showAnswersAfterSubmit,
      language: "hi",
      translatedFromQuizId: enQuiz._id
    });


    // Translate each question with parallel batching for speed
    const translatedQuestions: any[] = [];
    const questions = (enQuiz.questions || []) as any[];

    // Update total count in progress tracker
    translationProgressMap.set(progressId, {
      total: questions.length,
      completed: 0,
      percentage: 0,
      startTime,
      status: 'in_progress'
    });

    const BATCH_SIZE = 5; // Parallel translation requests
    console.log(`[TRANSLATION] Starting Hindi translation for "${enQuiz.title}" (${questions.length} questions)`);
    
    const translateInBatches = async () => {
      const results: any[] = [];
      const totalBatches = Math.ceil(questions.length / BATCH_SIZE);
      
      for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = questions.slice(i, i + BATCH_SIZE);
        const processedCount = Math.min(i + BATCH_SIZE, questions.length);
        const percentComplete = Math.round((processedCount / questions.length) * 100);
        
        console.log(`[TRANSLATION] Batch ${batchNum}/${totalBatches} - Progress: ${processedCount}/${questions.length} (${percentComplete}%)`);
        
        // Update progress in real-time
        translationProgressMap.set(progressId, {
          total: questions.length,
          completed: i, // Completed before this batch
          percentage: percentComplete,
          startTime,
          status: 'in_progress'
        });
        
        // Translate all questions in batch in parallel
        const translationPromises = batch.map(q =>
          (async () => {
            try {
              // Try Gemini first, fallback to OpenAI
              let translated = await translateWithGemini({
                text: q.text,
                options: q.options,
                explanation: q.explanation
              });

              if (!translated && env.openaiApiKey) {
                translated = await translateWithOpenAI({
                  text: q.text,
                  options: q.options,
                  explanation: q.explanation
                });
              }

              return { q, translated, error: null };
            } catch (err) {
              console.error(`Failed to translate question ${q._id}:`, err);
              return { q, translated: null, error: err };
            }
          })()
        );

        const batchResults = await Promise.all(translationPromises);
        results.push(...batchResults);
        
        // Small delay between batches to respect API rate limits
        if (i + BATCH_SIZE < questions.length) {
          await sleep(500);
        }
      }
      
      return results;
    };

    const translationResults = await translateInBatches();
    console.log(`[TRANSLATION] All batches completed for "${enQuiz.title}"`);

  // Create questions in database with translated content
  for (const { q, translated } of translationResults) {
    const hiQuestion = await Question.create({
      quizId: hiQuiz._id,

      // Store Hindi in *_hi fields so the UI can reliably read Hindi in Hindi mode.
      // Keep EN fields empty to avoid any fallback to English.
      text: "",
      options: ["", "", "", ""],
      explanation: "",

      text_hi: translated?.text || q.text,
      options_hi: translated?.options || q.options,
      explanation_hi: translated?.explanation || q.explanation,

      correctOptions: q.correctOptions,
      type: q.type,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      subject: q.subject,
      imageUrl: q.imageUrl,
      visualPdfUrl: q.visualPdfUrl,
      visualPageNumber: q.visualPageNumber,
      visualNote: q.visualNote,
      language: "hi",
      translatedFromQuestionId: q._id
    });

    translatedQuestions.push(hiQuestion);
  }


    // Link questions to Hindi quiz
    await Quiz.findByIdAndUpdate(hiQuiz._id, {
      $push: { questions: { $each: translatedQuestions.map((q) => q._id) } }
    });

    // Add quiz to section
    await Section.findByIdAndUpdate(section._id, { $push: { quizzes: hiQuiz._id } });

    // Update final progress status
    translationProgressMap.set(progressId, {
      total: questions.length,
      completed: translatedQuestions.length,
      percentage: 100,
      startTime,
      status: 'completed'
    });

    return res.status(201).json({
      progressId,
      hiQuizId: hiQuiz._id,
      enQuizId: enQuiz._id,
      questionCount: translatedQuestions.length,
      durationMs: Date.now() - startTime,
      progress: {
        total: questions.length,
        completed: translatedQuestions.length,
        percentage: 100
      }
    });
  } catch (err: any) {
    console.error('[TRANSLATION] Error:', err);
    
    // Mark translation as failed
    translationProgressMap.set(progressId, {
      total: 0,
      completed: 0,
      percentage: 0,
      startTime,
      status: 'failed',
      error: err.message
    });
    
    return res.status(500).json({ message: err.message || "Translation failed" });
  }
}
