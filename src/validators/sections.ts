import { z } from "zod";

export const createSectionSchema = z.object({
  body: z.object({
    courseId: z.string().min(1),
    title: z.string().min(2),
    order: z.number().int().min(0).optional()
  })
});

export const reorderSectionsSchema = z.object({
  body: z.object({
    courseId: z.string().min(1),
    orders: z.array(z.object({ id: z.string().min(1), order: z.number().int().min(0) }))
  })
});
