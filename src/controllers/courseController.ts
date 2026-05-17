import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { Course } from "../models/Course";
import { parsePagination } from "../utils/pagination";

export async function listCourses(req: AuthRequest, res: Response) {
  const { page, limit, skip } = parsePagination(req.query);
  const filter: any = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.examType) filter.examType = req.query.examType;

  const [items, total] = await Promise.all([
    Course.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
    Course.countDocuments(filter)
  ]);

  return res.json({ items, page, total, limit });
}

export async function getCourse(req: AuthRequest, res: Response) {
  const course = await Course.findById(req.params.id);
  if (!course) return res.status(404).json({ message: "Course not found" });
  return res.json(course);
}

export async function createCourse(req: AuthRequest, res: Response) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  const course = await Course.create({ ...req.body, createdBy: req.user.id });
  return res.status(201).json(course);
}

export async function updateCourse(req: AuthRequest, res: Response) {
  const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!course) return res.status(404).json({ message: "Course not found" });
  return res.json(course);
}

export async function deleteCourse(req: AuthRequest, res: Response) {
  const course = await Course.findByIdAndDelete(req.params.id);
  if (!course) return res.status(404).json({ message: "Course not found" });
  return res.status(204).send();
}
