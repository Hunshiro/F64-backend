import { Request, Response } from "express";
import { cloudinary } from "../config/cloudinary";

export async function uploadImage(req: Request, res: Response) {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ message: "File required" });

  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, { folder: "testbook" });
    return res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (err: any) {
    console.error("[uploadImage] Cloudinary upload failed:", {
      message: err?.message,
      name: err?.name,
      status: err?.http_code,
      raw: err
    });
    return res.status(500).json({ message: err?.message || "Cloudinary upload failed" });
  }

}
