import { Request, Response } from "express";
import { Types } from "mongoose";
import { Attempt } from "../models/Attempt";
import { Quiz } from "../models/Quiz";
import { Question } from "../models/Question";
import { Result } from "../models/Result";

type Difficulty = "easy" | "medium" | "hard";

type AnalyticsQuestion = {
  id: string;
  number: number;
  status: "correct" | "wrong" | "skipped";
  timeTaken: number;
  difficulty: Difficulty;
  topic: string;
  userAnswer: string;
  correctAnswer: string;
  explanation?: string;
  options: string[];
  userAnswerIndex?: number;
  correctAnswerIndex?: number;
  marks: number;
  text: string;
};

type AnalyticsSection = {
  subject: string;
  score: number;
  totalMarks: number;
  accuracy: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  timeSpentSeconds: number;
  percentile: number;
  rank: number;
  topperScore: number;
  avgScore: number;
  topics: { name: string; correct: number; total: number }[];
};

type AnalyticsResponse = {
  overall: {
    score: number;
    totalMarks: number;
    percentile: number;
    rank: number;
    totalCandidates: number;
    accuracy: number;
    attempted: number;
    correct: number;
    wrong: number;
    skipped: number;
    timeTakenSeconds: number;
    avgTimePerQuestion: number;
    selectionProbability: number;
    tierPrediction: string;
    performanceBadge: string;
  };
  sections: AnalyticsSection[];
  trends: { mock: string; score: number; avg: number }[];
  questions: AnalyticsQuestion[];
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// NOTE: This endpoint computes a best-effort analytics payload for the existing UI.
// It does not currently track per-question timing, so timeTaken/timeSpent will be 0.


function formatDifficulty(d: any): Difficulty {
  if (d === "easy" || d === "medium" || d === "hard") return d;
  return "medium";
}

function computeSelectionProbability(score: number, totalMarks: number) {
  if (!totalMarks) return 0;
  const pct = (score / totalMarks) * 100;
  return clamp(Math.round(pct), 0, 100);
}

function deriveBadge(acc: number) {
  if (acc >= 90) return "Topper";
  if (acc >= 75) return "Strong";
  return "Improving";
}

function deriveTier(acc: number) {
  if (acc >= 90) return "Safe for Tier-II";
  if (acc >= 75) return "On Track";
  return "Needs Focus";
}

export async function attemptAnalytics(req: Request, res: Response) {
  const { id } = req.params;
  const attemptId = new Types.ObjectId(id);

  const attempt = await Attempt.findById(attemptId).exec();
  if (!attempt) return res.status(404).json({ message: "Attempt not found" });

  const quiz = await Quiz.findById(attempt.quizId).exec();
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  // Fetch questions using the IDs array in the Quiz document.
  // Combined mocks don't update the quizId field on individual questions, so we must lookup by ID.
  const questions = await Question.find({ _id: { $in: quiz.questions } }).exec();
  
  // Maintain the specific section order (1-25: Reasoning, etc.)
  questions.sort((a, b) => quiz.questions.indexOf(a._id) - quiz.questions.indexOf(b._id));

  const result = await Result.findOne({ attemptId: attempt._id }).exec();

  // Use SSC CGL defaults (2/0.5) if marks are missing in DB
  const totalMarks = questions.reduce((sum, q) => sum + (q.marks ?? 2), 0);

  // Build question-by-question analytics from answers + question correctness.
  const questionRows: AnalyticsQuestion[] = questions.map((q, idx) => {
    const ans = attempt.answers.find((a) => a.questionId.toString() === q._id.toString());
    const selectedOptions = ans?.selectedOptions || [];

    const qMarks = q.marks ?? 2;
    const qNegMarks = q.negativeMarks ?? 0.5;

    const isAttempted = selectedOptions.length > 0;
    const isCorrect =
      q.correctOptions.length === selectedOptions.length &&
      q.correctOptions.every((v) => selectedOptions.includes(v));

    const isHindi = (quiz as any).language === "hi";

    const qText = isHindi ? (q.text_hi || q.text) : q.text;
    const qOptions = isHindi ? (q.options_hi && q.options_hi.length > 0 ? q.options_hi : q.options) : q.options;

    const status: AnalyticsQuestion["status"] = !isAttempted
      ? "skipped"
      : isCorrect
        ? "correct"
        : "wrong";

    const marks = !isAttempted
      ? 0
      : isCorrect
        ? qMarks
        : -qNegMarks;

    const correctAnswer = q.correctOptions
      .slice()
      .sort((a, b) => a - b)
      .map((optIdx) => qOptions?.[optIdx] ?? `${optIdx + 1}`)
      .join(", ");

    const userAnswer = selectedOptions
      .slice()
      .sort((a, b) => a - b)
      .map((optIdx) => qOptions?.[optIdx] ?? `${optIdx + 1}`)
      .join(", ");

    // We don't store per-question timing currently; keep 0.
    const timeTaken = 0;

    const difficulty = formatDifficulty(quiz.difficulty);
    let topic = q.subject || "";

    // For standard SSC CGL 100-question mocks, enforce section mapping by index.
    // This resolves issues where GA questions might be mislabeled or merged into English,
    // ensuring the analytics report perfectly matches the exam structure (25 questions per section).
    if (questions.length === 100) {
      if (idx < 25) topic = "Reasoning";
      else if (idx < 50) topic = "Quantitative Aptitude";
      else if (idx < 75) topic = "English Comprehension";
      else topic = "General Awareness";
    }

    // Fallback logic for explanations if field name varies (solution vs explanation)
    // @ts-ignore
    const rawExplanation = q.explanation || q.solution || "";
    // @ts-ignore
    const rawExplanationHi = q.explanation_hi || q.solution_hi || "";

    // Choose the explanation based on the attempt language
    const finalExplanation = isHindi 
      ? (rawExplanationHi || rawExplanation) 
      : rawExplanation;

    return {
      id: q._id.toString(),
      number: idx + 1,
      status,
      timeTaken,
      difficulty,
      topic,
      userAnswer: userAnswer || "—",
      correctAnswer: correctAnswer || "—",
      explanation: finalExplanation,
      options: qOptions || [],
      userAnswerIndex: selectedOptions.length > 0 ? selectedOptions[0] : undefined,
      correctAnswerIndex: q.correctOptions.length > 0 ? q.correctOptions[0] : undefined,
      marks,
      text: qText || ""
    };
  });

  // Recalculate score from questionRows to fix cases where result.score was saved as 0
  const myScore = questionRows.reduce((s, r) => s + r.marks, 0);

  const candidates = await Attempt.find({
    quizId: attempt.quizId,
    status: "submitted"
  }).select("_id");

  const candidateIds = candidates.map((a) => a._id);

  const candidateResults = await Result.find({ attemptId: { $in: candidateIds } })
    .select("attemptId score accuracy timeTakenSeconds")
    .exec();

  const sortedByScore = candidateResults
    .slice()
    .sort((a, b) => b.score - a.score);

  // Rank with ties: same score => same rank.
  // Rank = 1 + count of candidates with strictly higher score.
  let higherScores = 0;
  for (const r of sortedByScore) {
    if (r.score > myScore) higherScores += 1;
  }
  const myRank = higherScores + 1;

  const totalCandidates = sortedByScore.length;

  // Percentile (higher score => higher percentile). If totalCandidates=1 => 100.
  const myPercentile = totalCandidates > 1
    ? clamp(
        Math.round(((totalCandidates - myRank) / (totalCandidates - 1)) * 100),
        0,
        100
      )
    : 100;

  const attemptedCount = questionRows.filter((q) => q.status !== "skipped").length;
  const correctCount = questionRows.filter((q) => q.status === "correct").length;
  const wrongCount = questionRows.filter((q) => q.status === "wrong").length;
  const skippedCount = questionRows.filter((q) => q.status === "skipped").length;
  const recalculatedAccuracy = attemptedCount > 0 ? (correctCount / attemptedCount) * 100 : 0;

  const overall = {
    score: myScore,
    totalMarks: totalMarks || 0,
    percentile: myPercentile,
    rank: myRank,
    totalCandidates: totalCandidates || 0,
    accuracy: Number(recalculatedAccuracy.toFixed(1)),
    attempted: attemptedCount,
    correct: correctCount,
    wrong: wrongCount,
    skipped: skippedCount,
    timeTakenSeconds: result?.timeTakenSeconds ?? 0,
    avgTimePerQuestion: questions.length ? Math.round((result?.timeTakenSeconds ?? 0) / questions.length) : 0,
    selectionProbability: computeSelectionProbability(myScore ?? 0, totalMarks || 1),
    tierPrediction: deriveTier(recalculatedAccuracy),
    performanceBadge: deriveBadge(recalculatedAccuracy)
  };


  // Sections summary: group by question.subject, fallback to generic ordering based on quiz.
  const sectionMap = new Map<string, AnalyticsSection>();

  for (const row of questionRows) {
    const key = row.topic || "Other";
    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        subject: key,
        score: 0,
        totalMarks: 0,
        accuracy: 0,
        attempted: 0,
        correct: 0,
        wrong: 0,
        skipped: 0,
        timeSpentSeconds: 0,
        percentile: 0,
        rank: 0,
        topperScore: 0,
        avgScore: 0,
        topics: []
      });
    }

    const sec = sectionMap.get(key)!;

    // Get original question for total marks calculation
    const qOrigin = questions[row.number - 1];
    const qMarks = qOrigin?.marks ?? 2;

    sec.score += row.marks;
    sec.totalMarks += qMarks;
    sec.attempted += row.status === "skipped" ? 0 : 1;
    sec.correct += row.status === "correct" ? 1 : 0;
    sec.wrong += row.status === "wrong" ? 1 : 0;
    sec.skipped += row.status === "skipped" ? 1 : 0;
  }

  // Finalize accuracies and topics.
  const sections = Array.from(sectionMap.values()).map((sec) => {
    const attempted = sec.attempted;
    const accuracy = attempted > 0 ? (sec.correct / attempted) * 100 : 0;

    // topics breakdown: we only have subject; keep single topic bucket.
    const topics = sec.totalMarks > 0 ? [{ name: sec.subject, correct: sec.correct, total: sec.attempted || 1 }] : [];

    return {
      ...sec,
      accuracy,
      topics
    };
  });

  // Ensure we output 4 sections for the existing UI if possible.
  // If fewer/more subjects exist, keep as-is.

  // Trends: last 4 submitted attempts by same user.
  const lastAttempts = await Attempt.find({ userId: attempt.userId, status: "submitted" })
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(4)
    .exec();

  const lastAttemptIds = lastAttempts.map((a) => a._id);
  const lastResults = await Result.find({ attemptId: { $in: lastAttemptIds } }).exec();
  const lastResultMap = new Map(lastResults.map((r) => [r.attemptId.toString(), r]));

  const trends = lastAttempts
    .slice()
    .reverse()
    .map((a, idx) => {
      const r = lastResultMap.get(a._id.toString());
      const score = r?.score ?? 0;
      const avg = 0; // no historical avg computation per attempt baseline yet
      return { mock: `Mock ${idx + 1}`, score, avg };
    });

  const payload: AnalyticsResponse = {
    overall,
    sections,
    trends,
    questions: questionRows
  };

  return res.json(payload);
}
