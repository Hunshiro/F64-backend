import mongoose, { Schema, Types } from "mongoose";

export interface ResultDoc {
  attemptId: Types.ObjectId;
  score: number;
  accuracy: number;
  timeTakenSeconds: number;
  sectionWise: Record<string, { score: number; accuracy: number }>;
  topicWise: Record<string, { score: number; accuracy: number }>;
}

const resultSchema = new Schema<ResultDoc>(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },
    score: { type: Number, required: true },
    accuracy: { type: Number, required: true },
    timeTakenSeconds: { type: Number, required: true },
    sectionWise: { type: Object, default: {} },
    topicWise: { type: Object, default: {} }
  },
  { timestamps: true }
);

export const Result = mongoose.model<ResultDoc>("Result", resultSchema);
