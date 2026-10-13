import { Group } from "../models/Group";
import { validateCrossGroupAttendance } from "./attendanceScheduleValidator";
import { getTodayInTimezone } from "./timezoneUtils";
export async function prepareAttendance(teacherId: string, student: { _id: unknown; group_id?: unknown; grade_id?: unknown; group_join_date?: string | null; created_at?: Date }, input: Record<string, unknown>) {
  const date = input.session_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > getTodayInTimezone()) throw new Error("تاريخ الحضور غير صالح أو مستقبلي");
  if (!["present", "absent"].includes(String(input.status))) throw new Error("حالة الحضور غير صالحة");
  const group = student.group_id ? await Group.findOne({ _id: student.group_id, teacher_id: teacherId }).lean() : null;
  if (!group) throw new Error("الطالب غير مرتبط بمجموعة متاحة");
  if ((group.cancelled_sessions || []).includes(date) || (group.start_date && date < group.start_date)) throw new Error("الجلسة ملغاة أو قبل بداية المجموعة");
  const joined = student.group_join_date || (student.created_at ? new Date(student.created_at).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }) : null);
  if (joined && date < joined) throw new Error("لا يمكن تسجيل حضور قبل انضمام الطالب للمجموعة الحالية");
  const scannerId = String(input.scanner_group_id || input.group_id || group._id);
  if (scannerId !== String(group._id)) {
    const scanner = await Group.findOne({ _id: scannerId, teacher_id: teacherId }).lean();
    if (!scanner || (scanner.grade_id && group.grade_id && String(scanner.grade_id) !== String(group.grade_id))) throw new Error("المجموعة أو المرحلة غير متوافقة");
    const check = await validateCrossGroupAttendance({ ...group, id: String(group._id) }, scannerId, date);
    if (check.decision === "deny") throw new Error(check.reason);
  }
  const [year, month] = date.split("-").map(Number);
  return { student_id: String(student._id), teacher_id: teacherId, group_id: group._id, session_date: date, year, month, status: String(input.status) };
}
