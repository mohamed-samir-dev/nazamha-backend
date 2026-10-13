import crypto from "crypto";
import { Response } from "express";
import { Student } from "../models/Student";
import { StudentShareToken } from "../models/StudentShareToken";
import { AuthRequest, teacherFilter } from "../middleware/auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function resolveTeacherId(req: AuthRequest): string {
  if (req.user!.user_type === "staff" && req.user!.effective_teacher_id) {
    return req.user!.effective_teacher_id;
  }
  return req.user!.id;
}

// ── POST /api/students/:id/share-token ────────────────────────────────────────
// Generates a short-lived share token that allows anyone with the link to read
// the public student report without a session cookie.

export const generateShareToken = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  // Verify ownership — student must belong to the requesting user's scope
  const student = await Student.findOne({ _id: id, ...teacherFilter(req) }).lean();
  if (!student) {
    res.status(404).json({ message: "الطالب غير موجود" });
    return;
  }

  // TTL: default 24 h, max 168 h (7 days)
  const ttlHours = Number(req.body?.ttl_hours ?? 24);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 168) { res.status(400).json({ message: "مدة المشاركة يجب أن تكون بين صفر و168 ساعة" }); return; }
  const centerScope = req.body?.scope === "center";
  if (centerScope && (req.user!.user_type !== "center" || !student.center_student_id)) { res.status(403).json({ message: "مشاركة تقرير السنتر متاحة لمالكه فقط" }); return; }
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  // Generate a 32-byte random token (256 bits of entropy)
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const teacherId = String(student.teacher_id);

  await StudentShareToken.create({
    student_id: id,
    teacher_id: teacherId,
    center_student_id: centerScope ? student.center_student_id : null,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const origin = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
  const path = centerScope ? `report/c/${encodeURIComponent(student.center_student_code!)}` : `report/${id}`;
  const shareUrl = `${origin}/${path}?token=${rawToken}`;

  res.status(201).json({
    share_token: rawToken,
    expires_at: expiresAt,
    share_url: shareUrl,
  });
};

// ── DELETE /api/students/:id/share-token ──────────────────────────────────────
// Revokes all active share tokens for the given student.

export const revokeShareToken = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  // Verify ownership before revoking
  const student = await Student.findOne({ _id: id, ...teacherFilter(req) }).lean();
  if (!student) {
    res.status(404).json({ message: "الطالب غير موجود" });
    return;
  }

  const teacherId = resolveTeacherId(req);
  await StudentShareToken.deleteMany({ student_id: id });

  res.json({ message: "تم إلغاء رابط المشاركة" });
};
