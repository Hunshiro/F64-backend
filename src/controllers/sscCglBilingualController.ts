import { Request, Response } from "express";
import { Quiz } from "../models/Quiz";

/**
 * Given an English full mock quiz id, return the corresponding Hindi full mock quiz id.
 * Uses the bilingual linkage stored in Quiz.translatedFromQuizId.
 */
export async function getBilingualMockMap(req: Request, res: Response) {
  const { enQuizId } = req.params as { enQuizId: string };

  if (!enQuizId) {
    return res.status(400).json({ message: "enQuizId is required" });
  }

  // 1. Try finding Hindi version of an English quiz
  let targetQuiz = await Quiz.findOne({
    translatedFromQuizId: enQuizId,
    language: "hi"
  }).select("_id language translatedFromQuizId");

  if (targetQuiz) {
    return res.json({ enQuizId, hiQuizId: targetQuiz._id });
  }

  // 2. Try finding English version of a Hindi quiz
  const hiQuiz = await Quiz.findById(enQuizId).select("_id language translatedFromQuizId");
  if (hiQuiz && hiQuiz.language === "hi" && hiQuiz.translatedFromQuizId) {
    return res.json({
      enQuizId: String(hiQuiz.translatedFromQuizId),
      hiQuizId: hiQuiz._id
    });
  }

  return res.status(404).json({ 
    message: "Corresponding language version not found",
    debugInfo: { searchedId: enQuizId }
  });
}
