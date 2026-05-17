import { z } from "zod";

export const createCourseSchema = z.object({
  body: z.object({
    title: z.string().min(2),
    examType: z.enum(["Banking", "Insurance", "SSC", "Railway", "State", "Others"]),
    description: z.string().optional().default(""),
    thumbnail: z.string().url().optional(),
    priceType: z.enum(["free", "paid"]).default("free"),
    status: z.enum(["draft", "published"]).default("draft")
  })
});

export const updateCourseSchema = createCourseSchema;
