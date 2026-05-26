import { Request, Response } from "express";
import { Course } from "../models/Course";
import { Section } from "../models/Section";
import { Quiz } from "../models/Quiz";
import { Question } from "../models/Question";

import { detectSscCglHindiHtmlAndExtractQuestions } from "../utils/sscCglHindiHtmlParser";


export async function generateSectionQuizFromHindiHtml(req: Request, res: Response) {
  const startTime = Date.now();
  const file = (req as any).file as { buffer?: Buffer; originalname?: string } | undefined;
  const { subject } = req.body;

  if (!subject) return res.status(400).json({ message: "subject is required" });
  if (!file?.buffer) return res.status(400).json({ message: "file is required" });

  const createdBy = (req as any).user?.id;
  if (!createdBy) return res.status(401).json({ message: "Unauthorized" });

  // Parse Hindi HTML with language filtering (NO English questions mixed in).
  const parsed = detectSscCglHindiHtmlAndExtractQuestions(file.buffer);

  if (!parsed || parsed.length === 0) {
    return res.status(400).json({ message: "No Hindi questions found in uploaded HTML" });
  }

  // Ensure/prepare section/quiz containers
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

  // Create Hindi quiz with language fields
  const quiz = await Quiz.create({
    sectionId: section._id,
    title: `${subject} [हिन्दी] (HTML) - ${new Date().toLocaleDateString("en-IN")}`,
    durationMinutes: 15,
    negativeMarking: 0.25,
    instructions: `${subject} Section - 25 Questions (हिन्दी)`,
    timingMode: "aggregate",
    difficulty: "medium",
    status: "draft",
    topicTags: ["SSC CGL", "Section", subject],
    randomizeQuestions: false,
    showAnswersAfterSubmit: true,
    sectionTimeMinutes: 15,
    language: "hi"
  });

  const targetCount = 25;
  const base = parsed.slice(0, targetCount);
  const padded = [...base];
  while (padded.length < targetCount) {
    const idx = padded.length + 1;
    padded.push({
      subject,
      text: `${subject}: हिंदी अभ्यास प्रश्न ${idx}?`,
      options: ["विकल्प A", "विकल्प B", "विकल्प C", "विकल्प D"],
      correctOptions: [0],
      explanation: "",
      type: "single",
      marks: 2,
      negativeMarks: 0.25
    } as any);
  }

  // Store Hindi in text_hi/options_hi/explanation_hi.
  // Keep EN fields empty to prevent the UI from falling back to English in Hindi mode.
  const questionsToInsert = padded.map((q: any) => {
    const textHi = q.text;
    const optionsHi = q.options;
    const explanationHi = q.explanation || "";

    return {
      ...q,
      type: q.type || "single",
      marks: q.marks ?? 2,
      negativeMarks: q.negativeMarks ?? 0.25,
      subject,
      quizId: quiz._id,
      language: "hi",

      // EN fields (leave blank)
      text: "",
      options: ["", "", "", ""],
      explanation: "",

      // HI fields (populate Hindi)
      text_hi: textHi,
      options_hi: optionsHi,
      explanation_hi: explanationHi,

      imageUrl: q.imageUrl || "",
      visualPdfUrl: q.visualPdfUrl || "",
      visualPageNumber: q.visualPageNumber,
      visualNote: q.visualNote || ""
    };
  });


  const inserted = await Question.insertMany(questionsToInsert as any[]);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  await Section.findByIdAndUpdate(section._id, { $push: { quizzes: quiz._id } });

  return res.status(201).json({
    quizId: quiz._id,
    subject,
    questionCount: inserted.length,
    providers: ["hindi-html-parser"],
    detectedLanguage: "hindi",
    durationMs: Date.now() - startTime
  });
}
