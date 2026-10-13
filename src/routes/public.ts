import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { sharedRateStore } from "../services/sharedRateStore";
import { getPublicStudentReport, getPublicCenterStudentReport } from "../controllers/publicController";
import { asyncHandler } from "../middleware/asyncHandler";
import { CenterStudent } from "../models/CenterStudent";
import { StudentShareToken } from "../models/StudentShareToken";

const router = Router();

// Rate limiter for public report endpoints to prevent brute-force enumeration of student/center codes
const publicReportLimiter = rateLimit({
  store: sharedRateStore("public-report"),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 requests per 15 minutes per IP
  message: { message: "عدد طلبات كبير جداً، يرجى المحاولة لاحقاً" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── validateShareToken ────────────────────────────────────────────────────────
// Middleware that requires a valid share token in the query string before
// allowing access to the public student report.
// This replaces the previous zero-auth endpoint (C4 — Critical fix).

async function validateShareToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawToken = req.query.token as string | undefined;

  if (typeof rawToken !== "string" || !/^[a-f0-9]{64}$/.test(rawToken)) {
    res.status(401).json({ message: "مطلوب رمز الوصول" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const record = await StudentShareToken.findOne({
    token_hash: tokenHash,
    student_id: req.params.id,
    revoked: false,
    expires_at: { $gt: new Date() },
  }).lean();

  if (!record) {
    res.status(401).json({ message: "رمز الوصول غير صالح أو منتهي الصلاحية" });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  next();
}

router.get(
  "/student/:id",
  publicReportLimiter,
  asyncHandler(validateShareToken),
  asyncHandler(getPublicStudentReport)
);

async function validateCenterShareToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.query.token;
  if (typeof raw !== "string" || !/^[a-f0-9]{64}$/.test(raw)) { res.status(401).json({ message: "مطلوب رابط مشاركة صالح" }); return; }
  const token = await StudentShareToken.findOne({ token_hash: crypto.createHash("sha256").update(raw).digest("hex"), revoked: false, expires_at: { $gt: new Date() }, center_student_id: { $ne: null } }).lean();
  const identity = token ? await CenterStudent.findOne({ _id: token.center_student_id, center_student_code: req.params.centerCode }).lean() : null;
  if (!identity) { res.status(401).json({ message: "رابط المشاركة غير صالح" }); return; }
  res.locals.centerStudentId = identity._id;
  res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer"); next();
}
// Center reports require an owner-issued capability scoped to one identity.
router.get(
  "/center-student/:centerCode",
  publicReportLimiter,
  asyncHandler(validateCenterShareToken),
  asyncHandler(getPublicCenterStudentReport)
);

router.get(
  "/calendar/:teacherId.ics",
  publicReportLimiter,
  asyncHandler(async (req, res) => {
    const { exportPublicCalendarFeed } = await import("../controllers/groupsController");
    await exportPublicCalendarFeed(req, res);
  })
);

export default router;
