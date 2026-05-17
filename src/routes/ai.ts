import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  buildSscCglMock,
  generatePracticeQuiz,
  getLatestPublishedSscCglMock,
  getAllPublishedSscCglMocks,
  gradeWriting,
  listModels,
  previewSscCglSection,
  generateSectionQuiz,
  combineSectionQuizzes
} from "../controllers/aiController";
import { validate } from "../middleware/validate";
import { gradeWritingSchema, practiceQuizSchema } from "../validators/ai";
import { upload } from "../middleware/upload";

const router = Router();

router.get("/models", requireAuth, requireRole("admin"), listModels);
router.get("/ssc-cgl/latest-mock", requireAuth, getLatestPublishedSscCglMock);
router.get("/ssc-cgl/mocks", requireAuth, getAllPublishedSscCglMocks);
router.post("/practice-quiz", requireAuth, validate(practiceQuizSchema), generatePracticeQuiz);
router.post("/grade-writing", requireAuth, validate(gradeWritingSchema), gradeWriting);
router.post(
  "/ssc-cgl/section-quiz",
  requireAuth,
  requireRole("admin"),
  upload.single("file"),
  generateSectionQuiz
);
router.post(
  "/ssc-cgl/combine-sections",
  requireAuth,
  requireRole("admin"),
  combineSectionQuizzes
);
router.post(
  "/ssc-cgl/mock-builder",
  requireAuth,
  requireRole("admin"),
  upload.fields([
    { name: "reasoningPdf", maxCount: 1 },
    { name: "quantPdf", maxCount: 1 },
    { name: "englishPdf", maxCount: 1 },
    { name: "gaPdf", maxCount: 1 }
  ]),
  buildSscCglMock
);
router.post(
  "/ssc-cgl/preview-section",
  requireAuth,
  requireRole("admin"),
  upload.fields([
    { name: "reasoningPdf", maxCount: 1 },
    { name: "quantPdf", maxCount: 1 },
    { name: "englishPdf", maxCount: 1 },
    { name: "gaPdf", maxCount: 1 },
    { name: "file", maxCount: 1 }
  ]),
  previewSscCglSection
);

export default router;
