import { Request, Response } from "express";
import { Section } from "../models/Section";
import { Course } from "../models/Course";

export async function createSection(req: Request, res: Response) {
  const section = await Section.create(req.body);
  await Course.findByIdAndUpdate(section.courseId, { $push: { sections: section._id } });
  return res.status(201).json(section);
}

export async function listSections(req: Request, res: Response) {
  const courseId = req.query.courseId as string;
  if (!courseId) return res.status(400).json({ message: "courseId is required" });
  const sections = await Section.find({ courseId }).sort({ order: 1, createdAt: 1 });
  return res.json({ items: sections });
}

export async function reorderSections(req: Request, res: Response) {
  const { orders } = req.body;
  const updates = orders.map((o: { id: string; order: number }) =>
    Section.findByIdAndUpdate(o.id, { order: o.order })
  );
  await Promise.all(updates);
  return res.json({ ok: true });
}
