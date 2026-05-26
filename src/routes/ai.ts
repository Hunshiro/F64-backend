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
  combineSectionQuizzes,
  generateSectionQuizFromHtml,
  translateSectionQuiz,
  getTranslationProgress
} from "../controllers/aiController";

import { getBilingualMockMap } from "../controllers/sscCglBilingualController";


import { generateSectionQuizFromHindiHtml } from "../controllers/sscCglHindiHtmlController";

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
  "/ssc-cgl/combine-bilingual-sections",
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
    { name: "gaPdf", maxCount: 1 },
    { name: "reasoningEnHtml", maxCount: 1 },
    { name: "reasoningHiHtml", maxCount: 1 },
    { name: "quantEnHtml", maxCount: 1 },
    { name: "quantHiHtml", maxCount: 1 },
    { name: "englishEnHtml", maxCount: 1 },
    { name: "englishHiHtml", maxCount: 1 },
    { name: "gkEnHtml", maxCount: 1 },
    { name: "gkHiHtml", maxCount: 1 }
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
    { name: "reasoningEnHtml", maxCount: 1 },
    { name: "reasoningHiHtml", maxCount: 1 },
    { name: "quantEnHtml", maxCount: 1 },
    { name: "quantHiHtml", maxCount: 1 },
    { name: "englishEnHtml", maxCount: 1 },
    { name: "englishHiHtml", maxCount: 1 },
    { name: "gkEnHtml", maxCount: 1 },
    { name: "gkHiHtml", maxCount: 1 },
    { name: "file", maxCount: 1 }
  ]),
  previewSscCglSection
);

// New: Build a full SSC CGL section quiz from an uploaded HTML (not PDF)
router.post(
  "/ssc-cgl/section-quiz-from-html",
  requireAuth,
  requireRole("admin"),
  upload.single("file"),
  generateSectionQuizFromHtml
);

// Create a Hindi section quiz directly from Hindi HTML (NO translation)
router.post(
  "/ssc-cgl/section-quiz-from-hindi-html",
  requireAuth,
  requireRole("admin"),
  upload.single("file"),
  generateSectionQuizFromHindiHtml
);

// New: Translate an English section quiz to Hindi
router.post(
  "/ssc-cgl/translate-section",
  requireAuth,
  requireRole("admin"),
  translateSectionQuiz
);


// Get translation progress in real-time
router.get(
  "/ssc-cgl/translate-progress/:progressId",
  requireAuth,
  requireRole("admin"),
  getTranslationProgress
);

// Student bilingual mapping (EN -> HI quiz id)
router.get(
  "/ssc-cgl/bilingual-map/:enQuizId",
  requireAuth,
  getBilingualMockMap
);

export default router;


