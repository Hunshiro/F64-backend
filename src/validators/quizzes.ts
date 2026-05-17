import { z } from "zod";

export const createQuizSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1),
    title: z.string().min(2),
    durationMinutes: z.number().int().min(1),
    negativeMarking: z.number().min(0).optional(),
    instructions: z.string().optional(),
    timingMode: z.enum(["aggregate", "sectional"]).optional(),
    sectionTimeMinutes: z.number().int().min(1).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    topicTags: z.array(z.string()).optional(),
    status: z.enum(["draft", "published"]).optional(),
    randomizeQuestions: z.boolean().optional(),
    showAnswersAfterSubmit: z.boolean().optional()
  })
});
