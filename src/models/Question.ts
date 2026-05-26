import mongoose, { Schema, Types } from "mongoose";

export interface QuestionDoc {
  quizId: Types.ObjectId;
  subject?: string;
  visualPdfUrl?: string;
  visualPageNumber?: number;
  visualNote?: string;
  imageUrl?: string;
  text: string;
  options: string[];
  correctOptions: number[];
  type: "single" | "multi";
  marks: number;
  negativeMarks: number;
  explanation?: string;
  language?: "en" | "hi";
  translatedFromQuestionId?: Types.ObjectId;
}

const questionSchema = new Schema<QuestionDoc>(
  {
    quizId: { type: Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },
    subject: { type: String, default: "" },
    visualPdfUrl: { type: String, default: "" },
    visualPageNumber: { type: Number },
    visualNote: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    text: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctOptions: [{ type: Number, required: true }],
    type: { type: String, enum: ["single", "multi"], default: "single" },
    marks: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },
    explanation: { type: String, default: "" },
    language: { type: String, enum: ["en", "hi"], default: "en" },
    translatedFromQuestionId: { type: Schema.Types.ObjectId, ref: "Question", sparse: true }
  },
  { timestamps: true }
);

export const Question = mongoose.model<QuestionDoc>("Question", questionSchema);
