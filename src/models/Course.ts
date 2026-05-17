import mongoose, { Schema, Types } from "mongoose";

export type ExamType = "Banking" | "Insurance" | "SSC" | "Railway" | "State" | "Others";

export interface CourseDoc {
  title: string;
  examType: ExamType;
  description: string;
  thumbnail?: string;
  priceType: "free" | "paid";
  status: "draft" | "published";
  sections: Types.ObjectId[];
  createdBy: Types.ObjectId;
}

const courseSchema = new Schema<CourseDoc>(
  {
    title: { type: String, required: true, trim: true },
    examType: { type: String, required: true, enum: ["Banking", "Insurance", "SSC", "Railway", "State", "Others"] },
    description: { type: String, default: "" },
    thumbnail: { type: String },
    priceType: { type: String, enum: ["free", "paid"], default: "free" },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    sections: [{ type: Schema.Types.ObjectId, ref: "Section" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

courseSchema.index({ status: 1, examType: 1 });

export const Course = mongoose.model<CourseDoc>("Course", courseSchema);
