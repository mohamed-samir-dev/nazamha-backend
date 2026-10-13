import { Request, Response, NextFunction } from "express";

// MongoDB / Mongoose error codes
const MONGO_DUPLICATE_KEY = 11000;

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction): void => {
  // Don't log or re-process if headers already sent
  if (res.headersSent) return;

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e: any) => e.message).join(", ");
    res.status(400).json({ message: messages || "بيانات غير صحيحة" });
    return;
  }

  // Mongoose CastError (invalid ObjectId etc.)
  if (err.name === "CastError") {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  // MongoDB duplicate key
  if (err.code === MONGO_DUPLICATE_KEY) {
    res.status(409).json({ message: "هذا السجل موجود بالفعل" });
    return;
  }

  // MongoDB network / server selection errors — transient, safe to surface as 503
  if (
    err.name === "MongoNetworkError" ||
    err.name === "MongoServerSelectionError" ||
    err.name === "MongoNetworkTimeoutError"
  ) {
    console.error("❌ [DB]", err.name, err.message);
    res.status(503).json({ message: "قاعدة البيانات غير متاحة مؤقتاً، حاول مرة أخرى" });
    return;
  }

  // Connection pool timeout (waitQueueTimeoutMS exceeded)
  if (err.name === "MongoPoolClearedError" || err.message?.includes("timed out")) {
    console.error("❌ [DB pool]", err.message);
    res.status(503).json({ message: "الخادم مشغول، حاول مرة أخرى بعد لحظة" });
    return;
  }

  // CSRF errors
  if (err.code === "EBADCSRFTOKEN" || err.message === "invalid csrf token" || err.name === "ForbiddenError") {
    res.status(403).json({ message: "CSRF token غير صالح", error_code: "EBADCSRFTOKEN" });
    return;
  }

  // JWT errors
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    res.status(401).json({ message: "توكن غير صالح أو منتهي الصلاحية" });
    return;
  }

  // Generic server error
  console.error("❌", err.message, err.stack);
  res.status(500).json({ message: "حدث خطأ داخلي، حاول لاحقاً" });
};

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ message: "المسار غير موجود" });
};
