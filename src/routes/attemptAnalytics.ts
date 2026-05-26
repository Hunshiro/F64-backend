import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { attemptAnalytics } from "../controllers/attemptAnalyticsController";

const router = Router();

router.get("/:id/analytics", requireAuth, attemptAnalytics);

export default router;

