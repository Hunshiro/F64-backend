import bcrypt from "bcryptjs";
import { connectDb } from "../config/db";
import { User } from "../models/User";
import { Course } from "../models/Course";
import { Section } from "../models/Section";
import { Quiz } from "../models/Quiz";
import { Question } from "../models/Question";

async function seed() {
  await connectDb();
  await User.deleteMany({});
  await Course.deleteMany({});
  await Section.deleteMany({});
  await Quiz.deleteMany({});
  await Question.deleteMany({});

  const admin = await User.create({
    name: "Admin",
    email: "admin@testbook.dev",
    passwordHash: await bcrypt.hash("password", 10),
    role: "admin"
  });

  const course = await Course.create({
    title: "Banking PO Master",
    examType: "Banking",
    description: "Complete prep for PO",
    priceType: "free",
    status: "published",
    createdBy: admin._id
  });

  const section = await Section.create({
    courseId: course._id,
    title: "Quantitative Aptitude",
    order: 1
  });

  const quiz = await Quiz.create({
    sectionId: section._id,
    title: "QA Basics",
    durationMinutes: 20,
    negativeMarking: 0.25,
    difficulty: "easy",
    status: "published",
    randomizeQuestions: true,
    timingMode: "aggregate",
    instructions: "Read all questions carefully before answering."
  });

  await Question.create({
    quizId: quiz._id,
    text: "What is 15% of 200?",
    options: ["15", "20", "30", "35"],
    correctOptions: [2],
    type: "single",
    marks: 1,
    negativeMarks: 0.25
  });

  console.log("Seed complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
