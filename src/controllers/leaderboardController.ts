import { Request, Response } from "express";
import { Attempt } from "../models/Attempt";
import { Result } from "../models/Result";
import { User } from "../models/User";
import { Quiz } from "../models/Quiz";

export async function leaderboardForQuiz(req: Request, res: Response) {
  const { quizId } = req.params;

  const [quiz, attempts] = await Promise.all([
    Quiz.findById(quizId).exec(),
    Attempt.find({ quizId, status: "submitted" })
      .select("userId submittedAt")
      .sort({ submittedAt: -1, createdAt: -1 })
      .exec()
  ]);

  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  if (!attempts.length) {
    return res.json({ quizId, totalCandidates: 0, leaderboard: [] });
  }

  const attemptIds = attempts.map((a) => a._id);

  const results = await Result.find({ attemptId: { $in: attemptIds } })
    .select("attemptId score accuracy timeTakenSeconds")
    .exec();

  const resultMap = new Map(results.map((r) => [r.attemptId.toString(), r]));

  // If multiple attempts by same user exist, keep the BEST score attempt for leaderboard.
  const bestByUser = new Map<
    string,
    { userId: string; bestScore: number; accuracy: number; timeTakenSeconds: number; submittedAt: Date }
  >();

  for (const a of attempts) {
    const r = resultMap.get(a._id.toString());
    if (!r) continue;

    const key = a.userId.toString();
    const existing = bestByUser.get(key);
    const submittedAt = (a.submittedAt || a.createdAt) as Date;

    if (!existing) {
      bestByUser.set(key, {
        userId: key,
        bestScore: r.score,
        accuracy: r.accuracy,
        timeTakenSeconds: r.timeTakenSeconds,
        submittedAt
      });
      continue;
    }

    if (r.score > existing.bestScore) {
      bestByUser.set(key, {
        userId: key,
        bestScore: r.score,
        accuracy: r.accuracy,
        timeTakenSeconds: r.timeTakenSeconds,
        submittedAt
      });
    }
  }

  const userIds = Array.from(bestByUser.keys());
  const users = await User.find({ _id: { $in: userIds } })
    .select("name email")
    .exec();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const rows = Array.from(bestByUser.values())
    .map((x) => {
      const u = userMap.get(x.userId);
      return {
        userId: x.userId,
        name: u?.name || "Unknown",
        email: u?.email || "",
        score: x.bestScore,
        accuracy: x.accuracy,
        timeTakenSeconds: x.timeTakenSeconds,
        submittedAt: x.submittedAt
      };
    })
    .sort((a, b) => b.score - a.score || b.submittedAt.getTime() - a.submittedAt.getTime());

  // Rank with ties.
  let rank = 0;
  let prevScore: number | null = null;
  let idx = 0;

  const leaderboard = rows.map((row) => {
    idx += 1;
    if (prevScore === null || row.score !== prevScore) {
      rank = idx;
      prevScore = row.score;
    }
    return { ...row, rank };
  });

  return res.json({
    quizId,
    totalCandidates: leaderboard.length,
    leaderboard
  });
}

