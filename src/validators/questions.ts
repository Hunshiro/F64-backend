import { z } from "zod";

export const createQuestionSchema = z.object({
  body: z.object({
    quizId: z.string().min(1),
    text: z.string().min(2),
    options: z.array(z.string()).min(2),
    correctOptions: z.array(z.number().int().min(0)).min(1),
    type: z.enum(["single", "multi"]).default("single"),
    marks: z.number().min(1).default(1),
    negativeMarks: z.number().min(0).default(0),
    explanation: z.string().optional()
  })
});

export const aiGenerateSchema = z.object({
  body: z.object({
    quizId: z.string().min(1),
    instructions: z.string().optional(),
    timingMode: z.enum(["aggregate", "sectional"]).optional(),
    durationMinutes: z.coerce.number().int().min(1).optional(),
    sectionTimeMinutes: z.coerce.number().int().min(1).optional(),
    questionsLimit: z.coerce.number().int().min(1).max(50).optional()
  })
});
