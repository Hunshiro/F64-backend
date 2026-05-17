import mongoose, { Schema, Types } from "mongoose";

export interface SectionDoc {
  courseId: Types.ObjectId;
  title: string;
  order: number;
  quizzes: Types.ObjectId[];
}

const sectionSchema = new Schema<SectionDoc>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    title: { type: String, required: true },
    order: { type: Number, required: true, default: 0 },
    quizzes: [{ type: Schema.Types.ObjectId, ref: "Quiz" }]
  },
  { timestamps: true }
);

sectionSchema.index({ courseId: 1, order: 1 });

export const Section = mongoose.model<SectionDoc>("Section", sectionSchema);
