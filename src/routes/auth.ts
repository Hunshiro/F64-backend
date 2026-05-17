import { Router } from "express";
import { login, signup } from "../controllers/authController";
import { validate } from "../middleware/validate";
import { loginSchema, signupSchema } from "../validators/auth";

const router = Router();

router.post("/signup", validate(signupSchema), signup);
router.post("/login", validate(loginSchema), login);

export default router;
