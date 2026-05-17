import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createCourseSchema, updateCourseSchema } from "../validators/courses";
import { createCourse, deleteCourse, getCourse, listCourses, updateCourse } from "../controllers/courseController";

const router = Router();

router.get("/", requireAuth, listCourses);
router.get("/:id", requireAuth, getCourse);
router.post("/", requireAuth, requireRole("admin"), validate(createCourseSchema), createCourse);
router.put("/:id", requireAuth, requireRole("admin"), validate(updateCourseSchema), updateCourse);
router.delete("/:id", requireAuth, requireRole("admin"), deleteCourse);

export default router;

