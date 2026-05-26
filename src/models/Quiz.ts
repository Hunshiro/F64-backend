import mongoose, { Schema, Types } from "mongoose";

export interface QuizDoc {
  sectionId: Types.ObjectId;
  title: string;
  durationMinutes: number;
  negativeMarking: number;
  instructions?: string;
  timingMode: "aggregate" | "sectional";
  sectionTimeMinutes?: number;
  difficulty: "easy" | "medium" | "hard";
  topicTags: string[];
  status: "draft" | "published";
  questions: Types.ObjectId[];
  randomizeQuestions: boolean;
  showAnswersAfterSubmit: boolean;
  language: "en" | "hi";
  translatedFromQuizId?: Types.ObjectId;
}

const quizSchema = new Schema<QuizDoc>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true, index: true },
    title: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    negativeMarking: { type: Number, default: 0 },
    instructions: { type: String, default: "" },
    timingMode: { type: String, enum: ["aggregate", "sectional"], default: "aggregate" },
    sectionTimeMinutes: { type: Number },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    topicTags: [{ type: String }],
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    questions: [{ type: Schema.Types.ObjectId, ref: "Question" }],
    randomizeQuestions: { type: Boolean, default: false },
    showAnswersAfterSubmit: { type: Boolean, default: true },
    language: { type: String, enum: ["en", "hi"], default: "en" },
    translatedFromQuizId: { type: Schema.Types.ObjectId, ref: "Quiz", sparse: true }
  },
  { timestamps: true }
);

quizSchema.index({ sectionId: 1, status: 1 });

export const Quiz = mongoose.model<QuizDoc>("Quiz", quizSchema);
