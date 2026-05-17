import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createQuizSchema } from "../validators/quizzes";
import { createQuiz, deleteQuiz, getQuiz, getQuizPreview, listQuizzes, publishQuiz, getQuizWithQuestions } from "../controllers/quizController";

const router = Router();

router.post("/", requireAuth, requireRole("admin"), validate(createQuizSchema), createQuiz);
router.get("/", requireAuth, listQuizzes);
router.get("/:id/with-questions", requireAuth, requireRole("admin"), getQuizWithQuestions);
router.get("/:id", requireAuth, getQuiz);
router.patch("/:id/publish", requireAuth, requireRole("admin"), publishQuiz);
router.delete("/:id", requireAuth, requireRole("admin"), deleteQuiz);
router.get("/:id/preview", requireAuth, getQuizPreview);

export default router;

