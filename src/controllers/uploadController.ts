import { Request, Response } from "express";
import { cloudinary } from "../config/cloudinary";

export async function uploadImage(req: Request, res: Response) {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ message: "File required" });

  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, { folder: "testbook" });
  return res.json({ url: result.secure_url, publicId: result.public_id });
}
