import { Group } from "../models/Group";
import { validateCrossGroupAttendance } from "./attendanceScheduleValidator";
import { getTodayInTimezone } from "./timezoneUtils";
import { scheduledOn } from "./attendanceSession";
import {StudentMembership} from "../models/StudentMembership";
import {AttendanceSession} from "../models/AttendanceSession";
import {AttendanceLesson} from "../models/AttendanceLesson";
import {assertAttendanceWindow} from "./attendanceTiming";
export async function prepareAttendance(teacherId: string, student: { _id: unknown; group_id?: unknown; grade_id?: unknown; group_join_date?: string | null; created_at?: Date }, input: Record<string, unknown>, groups?: Map<string, any>) {
  const date = input.session_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > getTodayInTimezone()) throw new Error("تاريخ الحضور غير صالح أو مستقبلي");
  if (!["present", "absent"].includes(String(input.status))) throw new Error("حالة الحضور غير صالحة");
  const loadGroup = (id: unknown) => groups ? groups.get(String(id)) : Group.findOne({ _id: id, teacher_id: teacherId }).lean();
  const historic = !input.scanner_group_id && input.group_id && String(input.group_id)!==String(student.group_id) && student.group_join_date && date<student.group_join_date
    ? await StudentMembership.findOne({student_id:student._id,teacher_id:teacherId,group_id:input.group_id,starts_on:{$lte:date},$or:[{ends_on:null},{ends_on:{$gte:date}}]}).lean() : null;
  const group = historic?.group_id || student.group_id ? await loadGroup(historic?.group_id || student.group_id) : null;
  if (!group) throw new Error("الطالب غير مرتبط بمجموعة متاحة");
  if ((group.cancelled_sessions || []).includes(date) || (group.start_date && date < group.start_date)) throw new Error("الجلسة ملغاة أو قبل بداية المجموعة");
  const joined = historic?.starts_on || student.group_join_date || (student.created_at ? new Date(student.created_at).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }) : null);
  if (joined && date < joined) throw new Error("لا يمكن تسجيل حضور قبل انضمام الطالب للمجموعة الحالية");
  const scannerId = String(input.scanner_group_id || input.group_id || group._id);
  let attendanceDate = date;
  if (scannerId !== String(group._id)) {
    const scanner = await loadGroup(scannerId);
    if (!scanner || (scanner.grade_id && group.grade_id && String(scanner.grade_id) !== String(group.grade_id))) throw new Error("المجموعة أو المرحلة غير متوافقة");
    const check = await validateCrossGroupAttendance({ ...group, id: String(group._id) }, scannerId, date);
    if (check.decision === "deny") throw new Error(check.reason);
    attendanceDate = check.nextScheduledDate || date;
    if(joined && attendanceDate < joined) throw new Error("الحصة الأصلية قبل انضمام الطالب");
    if (check.decision === "confirm" && input.cross_group_confirmed !== true) throw new Error("يلزم تأكيد الحضور خارج المجموعة");
    if (!scheduledOn(scanner, date) || scanner.cancelled_sessions?.includes(date)) throw new Error("الجلسة المختارة ليست حصة متاحة لمجموعة السكان");
  } else if (!scheduledOn(group, date)) {
    const frozen=await AttendanceSession.findOne({group_id:group._id,teacher_id:teacherId,session_date:date}).lean();
    if(!frozen || frozen.cancelled) throw new Error("التاريخ ليس من أيام المجموعة أو حصة محفوظة متاحة");
  }
  const [year, month] = attendanceDate.split("-").map(Number);
  const managed=await AttendanceLesson.findOne({teacher_id:teacherId,group_id:scannerId,session_date:date,kind:"regular"}).lean();
  if(managed) {
    if(managed.state==="cancelled") throw new Error("الحصة ملغاة");
    if(input.source!=="correction") assertAttendanceWindow(managed);
    else if(typeof input.reason!=="string" || input.reason.trim().length<3) throw new Error("سبب التصحيح مطلوب");
  }
  return { student_id: String(student._id), teacher_id: teacherId, group_id: group._id, scanner_group_id: scannerId, scanner_session_date:date, session_date: attendanceDate, year, month, status: String(input.status) };
}
