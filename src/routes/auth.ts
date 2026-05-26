import { Router } from "express";
import { login, signup, sendOtp } from "../controllers/authController";
import { validate } from "../middleware/validate";
import { loginSchema, signupSchema } from "../validators/auth";

const router = Router();

router.post("/send-otp", sendOtp);
router.post("/signup", validate(signupSchema), signup);
router.post("/login", validate(loginSchema), login);

export default router;
