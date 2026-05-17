import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export function requireRole(role: "admin" | "student") {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}
