import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export function signToken(payload: { id: string; role: "admin" | "student" }) {
  const secret = env.jwtSecret as Secret;
  const options: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, secret, options);
}
