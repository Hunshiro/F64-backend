import { Request, Response } from "express";
import { Result } from "../models/Result";
import { Attempt } from "../models/Attempt";
import { User } from "../models/User";
import { Quiz } from "../models/Quiz";

export async function overview(req: Request, res: Response) {
  const results = await Result.find().limit(20).sort({ createdAt: -1 });
  return res.json({ results });
}

export async function adminAttemptAnalytics(_req: Request, res: Response) {
  const [attempts, results] = await Promise.all([
    Attempt.find({ status: "submitted" }).sort({ submittedAt: -1, createdAt: -1 }).limit(100),
    Result.find().sort({ createdAt: -1 })
  ]);

  const attemptIds = attempts.map((attempt) => attempt._id);
  const [linkedResults, users, quizzes] = await Promise.all([
    Result.find({ attemptId: { $in: attemptIds } }),
    User.find({ _id: { $in: attempts.map((attempt) => attempt.userId) } }).select("name email"),
    Quiz.find({ _id: { $in: attempts.map((attempt) => attempt.quizId) } }).select("title durationMinutes")
  ]);

  const resultMap = new Map(linkedResults.map((result) => [result.attemptId.toString(), result]));
  const userMap = new Map(users.map((user) => [user._id.toString(), user]));
  const quizMap = new Map(quizzes.map((quiz) => [quiz._id.toString(), quiz]));

  const rows = attempts.map((attempt) => {
    const result = resultMap.get(attempt._id.toString());
    const user = userMap.get(attempt.userId.toString());
    const quiz = quizMap.get(attempt.quizId.toString());
    return {
      attemptId: attempt._id,
      studentName: user?.name || "Unknown student",
      studentEmail: user?.email || "",
      quizTitle: quiz?.title || "Deleted quiz",
      durationMinutes: quiz?.durationMinutes || 0,
      score: result?.score ?? 0,
      accuracy: result?.accuracy ?? 0,
      timeTakenSeconds: result?.timeTakenSeconds ?? 0,
      submittedAt: attempt.submittedAt || attempt.startedAt
    };
  });

  const completedResults = results.length;
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  const totalAccuracy = results.reduce((sum, result) => sum + result.accuracy, 0);
  const avgScore = completedResults ? totalScore / completedResults : 0;
  const avgAccuracy = completedResults ? totalAccuracy / completedResults : 0;
  const uniqueStudents = new Set(attempts.map((attempt) => attempt.userId.toString())).size;
  const bestScore = completedResults ? Math.max(...results.map((result) => result.score)) : 0;

  return res.json({
    metrics: {
      submittedAttempts: attempts.length,
      uniqueStudents,
      avgScore,
      avgAccuracy,
      bestScore
    },
    attempts: rows
  });
}
