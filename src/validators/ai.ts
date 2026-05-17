import { z } from "zod";

export const practiceQuizSchema = z.object({
  body: z.object({
    examType: z.enum(["Banking", "Insurance"]),
    topic: z.string().min(2),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    durationMinutes: z.coerce.number().int().min(5).max(240),
    questionsLimit: z.coerce.number().int().min(5).max(50)
  })
});

export const gradeWritingSchema = z.object({
  body: z.object({
    essayTopic: z.string().min(2),
    letterTopic: z.string().min(2),
    essayText: z.string().min(20),
    letterText: z.string().min(20),
    essayWordCount: z.coerce.number().int().min(0),
    letterWordCount: z.coerce.number().int().min(0),
    essayTargetWords: z.coerce.number().int().min(50).max(1000),
    letterTargetWords: z.coerce.number().int().min(50).max(1000),
    maxEssayMarks: z.coerce.number().int().min(1).max(50),
    maxLetterMarks: z.coerce.number().int().min(1).max(50)
  })
});
