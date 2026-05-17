import { Request, Response } from "express";
import { Quiz } from "../models/Quiz";
import { Section } from "../models/Section";
import { Question } from "../models/Question";
import { Attempt } from "../models/Attempt";
import { Result } from "../models/Result";

export async function createQuiz(req: Request, res: Response) {
  const quiz = await Quiz.create(req.body);
  await Section.findByIdAndUpdate(quiz.sectionId, { $push: { quizzes: quiz._id } });
  return res.status(201).json(quiz);
}

export async function listQuizzes(req: Request, res: Response) {
  const sectionId = req.query.sectionId as string;
  const status = req.query.status as string;
  
  let filter: any = {};
  if (sectionId) filter.sectionId = sectionId;
  if (status) filter.status = status;
  
  const quizzes = await Quiz.find(filter).sort({ createdAt: -1 });
  return res.json({ items: quizzes });
}

export async function getQuiz(req: Request, res: Response) {
  const quiz = await Quiz.findById(req.params.id).populate("questions");
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  return res.json(quiz);
}

export async function deleteQuiz(req: Request, res: Response) {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const attemptIds = (await Attempt.find({ quizId: quiz._id }).select("_id")).map((a) => a._id);

  await Promise.all([
    Question.deleteMany({ quizId: quiz._id }),
    Attempt.deleteMany({ quizId: quiz._id }),
    Result.deleteMany({ attemptId: { $in: attemptIds } }),
    Section.findByIdAndUpdate(quiz.sectionId, { $pull: { quizzes: quiz._id } })
  ]);
  await Quiz.findByIdAndDelete(quiz._id);

  return res.status(204).send();
}

export async function getQuizPreview(req: Request, res: Response) {
  const quiz = await Quiz.findById(req.params.id).populate("questions");
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  return res.json(quiz);
}

export async function getQuizWithQuestions(req: Request, res: Response) {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  
  const questions = await Question.find({ quizId: quiz._id });
  return res.json({ quiz, questions });
}

export async function publishQuiz(req: Request, res: Response) {
  const quiz = await Quiz.findByIdAndUpdate(req.params.id, { status: "published" }, { new: true });
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });
  return res.json(quiz);
}
