import crypto from "crypto";

interface CardIdentity { _id?: unknown; id?: unknown; teacher_id?: unknown; card_qr_version?: number }

/** A permanent, student-scoped read capability. Independent of group/code. */
export function studentCardToken(student: CardIdentity): string | undefined {
  const secret = process.env.STUDENT_CARD_SECRET || process.env.JWT_SECRET;
  const id = student._id || student.id;
  if (!secret || !id || !student.teacher_id) return undefined;
  return crypto.createHmac("sha256", secret).update(`student-card:v1:${String(id)}:${String(student.teacher_id)}:${student.card_qr_version ?? 0}`).digest("hex");
}

export function validStudentCard(student: CardIdentity, token: unknown): boolean {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
  const expected = studentCardToken(student);
  return !!expected && crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
}
