import { Student } from "../models/Student";

/** Resolve permanent card identity within the caller's teacher scope. */
export async function findScannedStudent(scope: Record<string, unknown>, input: { student_id?: string; student_code?: string }) {
  if (input.student_id) {
    if (!/^[a-f0-9]{24}$/i.test(input.student_id)) return null;
    return Student.findOne({ ...scope, _id: input.student_id }).lean();
  }
  if (typeof input.student_code !== "string") return null;
  const raw = input.student_code.trim();
  const centerMatch = raw.match(/\/report\/c\/([^/?#]+)/);
  const studentMatch = centerMatch ? null : raw.match(/\/report\/([^/?#]+)/);
  let value = centerMatch?.[1] || studentMatch?.[1] || raw;
  try { value = decodeURIComponent(value); } catch { return null; }
  if (!value) return null;
  if (!centerMatch && /^[a-f0-9]{24}$/i.test(value)) {
    return Student.findOne({ ...scope, _id: value }).lean();
  }
  // Stable center identity takes precedence over a changeable group code.
  const centerStudent = await Student.findOne({ ...scope, center_student_code: value.toUpperCase() }).lean();
  if (centerMatch) return centerStudent;
  const groupStudent = await Student.findOne({ ...scope, $expr: { $eq: [{ $toUpper: { $trim: { input: "$code" } } }, value.toUpperCase()] } }).lean();
  if (centerStudent && groupStudent && String(centerStudent._id) !== String(groupStudent._id)) return null;
  return centerStudent || groupStudent;
}
