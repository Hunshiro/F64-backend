import mongoose, { Schema, Types } from "mongoose";

export interface QuestionDoc {
  quizId: Types.ObjectId;
  subject?: string;
  visualPdfUrl?: string;
  visualPageNumber?: number;
  visualNote?: string;
  imageUrl?: string;

  // English fields
  text: string;
  options: string[];

  // Hindi fields (optional; used when quiz language is hi)
  text_hi?: string;
  options_hi?: string[];

  correctOptions: number[];
  type: "single" | "multi";
  marks: number;
  negativeMarks: number;
  explanation?: string;
  explanation_hi?: string;
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

    // English
    text: { type: String, required: true },
    options: [{ type: String, required: true }],

    // Hindi
    text_hi: { type: String, default: "" },
    options_hi: [{ type: String, default: "" }],

    correctOptions: [{ type: Number, required: true }],
    type: { type: String, enum: ["single", "multi"], default: "single" },
    marks: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },
    explanation: { type: String, default: "" },
    explanation_hi: { type: String, default: "" },

    language: { type: String, enum: ["en", "hi"], default: "en" },
    translatedFromQuestionId: { type: Schema.Types.ObjectId, ref: "Question", sparse: true }
  },
  { timestamps: true }
);


export const Question = mongoose.model<QuestionDoc>("Question", questionSchema);
