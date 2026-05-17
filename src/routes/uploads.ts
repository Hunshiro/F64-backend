import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { upload } from "../middleware/upload";
import { uploadImage } from "../controllers/uploadController";

const router = Router();

router.post("/image", requireAuth, requireRole("admin"), upload.single("file"), uploadImage);

export default router;
