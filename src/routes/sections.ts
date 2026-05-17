import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createSectionSchema, reorderSectionsSchema } from "../validators/sections";
import { createSection, listSections, reorderSections } from "../controllers/sectionController";

const router = Router();

router.post("/", requireAuth, requireRole("admin"), validate(createSectionSchema), createSection);
router.get("/", requireAuth, listSections);
router.patch("/reorder", requireAuth, requireRole("admin"), validate(reorderSectionsSchema), reorderSections);

export default router;
