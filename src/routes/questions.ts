import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { upload } from "../middleware/upload";
import { aiGenerateSchema, createQuestionSchema } from "../validators/questions";
import { aiGenerateQuestions, bulkUploadQuestions, createQuestion, updateQuestion } from "../controllers/questionController";

const router = Router();

router.post("/", requireAuth, requireRole("admin"), validate(createQuestionSchema), createQuestion);
router.post("/bulk", requireAuth, requireRole("admin"), upload.single("file"), bulkUploadQuestions);
router.post("/ai-generate", requireAuth, requireRole("admin"), upload.single("file"), validate(aiGenerateSchema), aiGenerateQuestions);
router.patch("/:id", requireAuth, requireRole("admin"), updateQuestion);

export default router;
