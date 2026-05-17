import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { autosaveAttempt, startAttempt, submitAttempt } from "../controllers/attemptController";
import { autosaveSchema, startAttemptSchema } from "../validators/attempts";

const router = Router();

router.post("/start", requireAuth, validate(startAttemptSchema), startAttempt);
router.patch("/:id/autosave", requireAuth, validate(autosaveSchema), autosaveAttempt);
router.post("/:id/submit", requireAuth, submitAttempt);

export default router;

