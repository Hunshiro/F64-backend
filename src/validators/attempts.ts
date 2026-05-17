import { z } from "zod";

export const startAttemptSchema = z.object({
  body: z.object({
    quizId: z.string().min(1)
  })
});

export const autosaveSchema = z.object({
  body: z.object({
    answers: z.array(z.object({
      questionId: z.string().min(1),
      selectedOptions: z.array(z.number().int().min(0))
    }))
  })
});
