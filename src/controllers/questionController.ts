import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import pdfParse from "pdf-parse";
import { Question } from "../models/Question";
import { Quiz } from "../models/Quiz";
import { generateQuestionsWithGemini } from "../services/gemini";
import { generateQuestionsWithOpenAI } from "../services/openai";
import { env } from "../config/env";

export async function createQuestion(req: Request, res: Response) {
  const question = await Question.create(req.body);
  await Quiz.findByIdAndUpdate(question.quizId, { $push: { questions: question._id } });
  return res.status(201).json(question);
}

export async function updateQuestion(req: Request, res: Response) {
  const { id } = req.params;
  const { text, options, correctOptions, explanation, visualPdfUrl, visualPageNumber, visualNote, imageUrl, type, marks, negativeMarks } = req.body;
  
  
  const updateData: any = {};
  if (text !== undefined) updateData.text = text;
  if (options !== undefined) updateData.options = options;
  if (correctOptions !== undefined) updateData.correctOptions = correctOptions;
  if (explanation !== undefined) updateData.explanation = explanation;
  if (visualPdfUrl !== undefined) updateData.visualPdfUrl = visualPdfUrl;
  if (visualPageNumber !== undefined) updateData.visualPageNumber = visualPageNumber;
  if (visualNote !== undefined) updateData.visualNote = visualNote;
  if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
  if (type !== undefined) updateData.type = type;

  if (marks !== undefined) updateData.marks = marks;
  if (negativeMarks !== undefined) updateData.negativeMarks = negativeMarks;
  
  const question = await Question.findByIdAndUpdate(id, updateData, { new: true });
  if (!question) return res.status(404).json({ message: "Question not found" });
  
  return res.json(question);
}

export async function bulkUploadQuestions(req: Request, res: Response) {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ message: "CSV file required" });

  const text = file.buffer.toString("utf8");
  const records = parse(text, { columns: true, skip_empty_lines: true });

  const quizIdFromBody = req.body.quizId;
  const docs = records
    .map((r: any) => ({
      quizId: r.quizId || quizIdFromBody,
      text: r.text,
      options: String(r.options || "")
        .split("|")
        .map((s: string) => s.trim())
        .filter(Boolean),
      correctOptions: String(r.correctOptions || "")
        .split("|")
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !Number.isNaN(n)),
      type: (r.type || "single").toLowerCase() === "multi" ? "multi" : "single",
      marks: r.marks ? Number(r.marks) : 1,
      negativeMarks: r.negativeMarks ? Number(r.negativeMarks) : 0
    }))
    .filter((d: any) => d.quizId && d.text && d.options.length > 1 && d.correctOptions.length > 0);

  if (!docs.length) return res.status(400).json({ message: "No valid questions found" });

  const inserted = await Question.insertMany(docs);
  const quizId = docs[0]?.quizId;
  if (quizId) {
    await Quiz.findByIdAndUpdate(quizId, { $push: { questions: { $each: inserted.map((q) => q._id) } } });
  }
  return res.status(201).json({ count: inserted.length });
}

function extractQuestions(text: string, limit: number) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const candidates = lines.filter((l) => l.endsWith("?"));
  const picked = (candidates.length ? candidates : lines).slice(0, limit);
  return picked.map((q) => ({
    text: q.replace(/^\d+[\).\s]+/, ""),
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctOptions: [0],
    type: "single" as const,
    marks: 1,
    negativeMarks: 0,
    explanation: ""
  }));
}

export async function aiGenerateQuestions(req: Request, res: Response) {
  const startTime = Date.now();
  const file = (req as any).file as { buffer?: Buffer } | undefined;
  const { quizId, instructions, timingMode, durationMinutes, sectionTimeMinutes, questionsLimit } = req.body || {};
  if (!quizId) return res.status(400).json({ message: "quizId is required" });

  const quiz = await Quiz.findById(quizId);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  let text = instructions || "";
  if (file?.buffer) {
    console.log(`[AI] Parsing PDF for quiz ${quizId}...`);
    const parsed = await pdfParse(file.buffer);
    text = `${text}\n${parsed.text || ""}`.trim();
  }

  const limit = Math.min(Number(questionsLimit || 10), 50);
  console.log(`[AI] Generating ${limit} questions via OpenRouter...`);
  const openRouterQuestions = await generateQuestionsWithGemini({
    instructions: String(instructions || ""),
    sourceText: text,
    questionsLimit: limit
  });
  console.log("AI debug: openRouterQuestions", openRouterQuestions.length, "model", env.geminiModel, "hasKey", Boolean(env.geminiApiKey));
  const openAiQuestions =
    openRouterQuestions.length > 0
      ? []
      : await generateQuestionsWithOpenAI({
          instructions: String(instructions || ""),
          sourceText: text,
          questionsLimit: limit
        });
  const aiQuestions = openRouterQuestions.length > 0 ? openRouterQuestions : openAiQuestions;
  const usedAi = aiQuestions.length > 0;
  const aiProvider = openRouterQuestions.length > 0 ? "openrouter" : openAiQuestions.length > 0 ? "openai" : "fallback";
  console.log("AI debug: provider", aiProvider, "usedAi", usedAi);
  const generatedRaw = usedAi ? aiQuestions : extractQuestions(text, limit);
  const generated = generatedRaw.filter(
    (q: any) => q && typeof q.text === "string" && q.text.trim() && Array.isArray(q.options) && q.options.length > 1
  );
  if (!generated.length && usedAi) {
    const fallback = extractQuestions(text, limit);
    generated.push(...fallback);
  }
  if (!generated.length) return res.status(400).json({ message: "No questions generated" });

  if (timingMode) quiz.timingMode = timingMode;
  if (durationMinutes) quiz.durationMinutes = Number(durationMinutes);
  if (sectionTimeMinutes) quiz.sectionTimeMinutes = Number(sectionTimeMinutes);
  if (instructions) quiz.instructions = instructions;
  await quiz.save();

  const docs = generated.map((g) => ({ ...g, quizId: quiz._id }));
  const inserted = await Question.insertMany(docs);
  await Quiz.findByIdAndUpdate(quiz._id, { $push: { questions: { $each: inserted.map((q) => q._id) } } });

  const durationMs = Date.now() - startTime;
  console.log(`[AI] Finished in ${durationMs}ms using ${aiProvider}`);

  return res.status(201).json({ count: inserted.length, quizId: quiz._id, usedAi, aiProvider, durationMs });
}
