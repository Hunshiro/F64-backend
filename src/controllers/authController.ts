import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import { User } from "../models/User";
import { signToken } from "../utils/jwt";

export async function signup(req: Request, res: Response) {
  const { name, email, password, role } = req.body;
  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: "Email already exists" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, role: role || "student" });
  const token = signToken({ id: user._id.toString(), role: user.role });
  return res.status(201).json({ token, user: { id: user._id, name: user.name, role: user.role, email: user.email } });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const token = signToken({ id: user._id.toString(), role: user.role });
  return res.json({ token, user: { id: user._id, name: user.name, role: user.role, email: user.email } });
}
