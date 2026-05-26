import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { leaderboardForQuiz } from "../controllers/leaderboardController";

const router = Router();

router.get("/:quizId", requireAuth, leaderboardForQuiz);

export default router;


