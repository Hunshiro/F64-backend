import mongoose, { Schema, Types } from "mongoose";

export interface AttemptAnswer {
  questionId: Types.ObjectId;
  selectedOptions: number[];
}

export interface AttemptDoc {
  userId: Types.ObjectId;
  quizId: Types.ObjectId;
  answers: AttemptAnswer[];

  startedAt: Date;

  // Either field may exist depending on how attempts were created.
  // Our model uses `timestamps: true` which also provides `createdAt`.
  submittedAt?: Date;
  createdAt?: Date;

  status: "in_progress" | "submitted";
}


const attemptSchema = new Schema<AttemptDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    quizId: { type: Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },
    answers: [
      {
        questionId: { type: Schema.Types.ObjectId, ref: "Question" },
        selectedOptions: [{ type: Number }]
      }
    ],
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    status: { type: String, enum: ["in_progress", "submitted"], default: "in_progress" }
  },
  { timestamps: true }
);

attemptSchema.index({ userId: 1, quizId: 1, status: 1 });

export const Attempt = mongoose.model<AttemptDoc>("Attempt", attemptSchema);
