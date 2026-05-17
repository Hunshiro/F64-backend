import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { adminAttemptAnalytics, overview } from "../controllers/analyticsController";

const router = Router();

router.get("/overview", requireAuth, overview);
router.get("/admin-attempts", requireAuth, requireRole("admin"), adminAttemptAnalytics);

export default router;
