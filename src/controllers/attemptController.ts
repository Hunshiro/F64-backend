import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { Attempt } from "../models/Attempt";
import { Quiz } from "../models/Quiz";
import { Question } from "../models/Question";
import { Result } from "../models/Result";

export async function startAttempt(req: AuthRequest, res: Response) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  const attempt = await Attempt.create({ userId: req.user.id, quizId: req.body.quizId });
  return res.status(201).json(attempt);
}

export async function autosaveAttempt(req: AuthRequest, res: Response) {
  const attempt = await Attempt.findByIdAndUpdate(req.params.id, { answers: req.body.answers }, { new: true });
  if (!attempt) return res.status(404).json({ message: "Attempt not found" });
  return res.json(attempt);
}

export async function submitAttempt(req: AuthRequest, res: Response) {
  const attempt = await Attempt.findById(req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt not found" });

  const quiz = await Quiz.findById(attempt.quizId);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const questions = await Question.find({ quizId: quiz._id });
  let score = 0;
  let correct = 0;
  let total = questions.length;

  for (const q of questions) {
    const ans = attempt.answers.find(
      (a: { questionId: { toString: () => string }; selectedOptions: number[] }) =>
        a.questionId.toString() === q._id.toString()
    );
    if (!ans) continue;
    const isCorrect =
      q.correctOptions.length === ans.selectedOptions.length &&
      q.correctOptions.every((v: number) => ans.selectedOptions.includes(v));
    if (isCorrect) {
      score += q.marks;
      correct += 1;
    } else {
      score -= q.negativeMarks;
    }
  }

  const accuracy = total > 0 ? (correct / total) * 100 : 0;
  attempt.status = "submitted";
  attempt.submittedAt = new Date();
  await attempt.save();

  const result = await Result.create({
    attemptId: attempt._id,
    score,
    accuracy,
    timeTakenSeconds: 0,
    sectionWise: {},
    topicWise: {}
  });

  const review =
    quiz.showAnswersAfterSubmit
      ? questions.map((q) => {
          const ans = attempt.answers.find(
            (a: { questionId: { toString: () => string }; selectedOptions: number[] }) =>
              a.questionId.toString() === q._id.toString()
          );
          return {
            questionId: q._id,
            text: q.text,
            options: q.options,
            correctOptions: q.correctOptions,
            selectedOptions: ans?.selectedOptions || [],
            explanation: q.explanation || ""
          };
        })
      : [];

  return res.json({ attempt, result, review });
}
