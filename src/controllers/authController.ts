import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import { User } from "../models/User";
import { signToken } from "../utils/jwt";
import { Resend } from 'resend';

// Initialize Resend (ensure RESEND_API_KEY is in your .env)
const resend = new Resend(process.env.RESEND_API_KEY);

// Temporary in-memory store for OTPs (In production, use Redis or a DB collection)
const otpStore = new Map<string, { otp: string, expires: number }>();

export async function sendOtp(req: Request, res: Response) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const normalizedEmail = email.toLowerCase().trim();

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiry

  console.log(`[AUTH] Generated OTP ${otp} for ${normalizedEmail}`);

  try {
    const { data, error } = await resend.emails.send({
      from: 'F64 Academy <onboarding@resend.dev>', // Use this for testing
      to: normalizedEmail,
      subject: 'Your Verification Code - F64 Academy',
      html: `<p>Your verification code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`
    });

    if (error) {
      console.error("Resend delivery error:", error);
      return res.status(400).json({ message: error.message });
    }

    console.log("Email sent successfully. ID:", data?.id);

    otpStore.set(normalizedEmail, { otp, expires });
    return res.json({ message: "OTP sent successfully" });
  } catch (err: any) {
    console.error("Resend error:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
}

export async function signup(req: Request, res: Response) {
  const { name, email, password, role } = req.body;

  const normalizedEmail = email?.toLowerCase().trim();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ message: "Email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ 
    name, 
    email, 
    passwordHash, 
    role: role || "student",
  });

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
