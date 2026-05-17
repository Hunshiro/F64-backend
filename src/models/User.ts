import mongoose, { Schema, Types } from "mongoose";

export type UserRole = "admin" | "student";

export interface UserDoc {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  enrolledCourses: Types.ObjectId[];
  createdAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "student"], default: "student" },
    enrolledCourses: [{ type: Schema.Types.ObjectId, ref: "Course" }]
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const User = mongoose.model<UserDoc>("User", userSchema);
