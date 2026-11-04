import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const UPLOAD_DIR = process.env.VERCEL
  ? path.join("/tmp", "uploads", "exams")
  : path.join(process.cwd(), "uploads", "exams");

// Note: Directory creation is deferred to the storage.destination callback
// to avoid crashing on Vercel's read-only filesystem during module initialization.

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      cb(null, UPLOAD_DIR);
    } catch (err) {
      console.error("[upload] Failed to create upload directory:", err);
      cb(err as Error, UPLOAD_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    const unique = crypto.randomBytes(16).toString("hex");
    cb(null, `q_${Date.now()}_${unique}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const uploadExamImage = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("نوع الملف غير مدعوم. الأنواع المدعومة: PNG, JPG, JPEG, WEBP, GIF"));
    }
  },
});
