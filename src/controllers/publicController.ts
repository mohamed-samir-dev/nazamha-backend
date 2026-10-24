import { Request, Response } from "express";
import { Student } from "../models/Student";
import { Teacher } from "../models/Teacher";
import { Group } from "../models/Group";
import { Grade } from "../models/Grade";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { Exam, ExamGrade } from "../models/Exam";
import { SystemSettings } from "../models/SystemSettings";
import { BookSale } from "../models/BookSale";
import { StudentMembership } from "../models/StudentMembership";
import { getTodayInTimezone } from "../utils/timezoneUtils";
import { reportAttendance } from "../utils/reportAttendance";
import {effectiveResolutions,mergeAttendanceResolutions} from "../services/attendanceResolutions";

export const getPublicStudentReport = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const today = getTodayInTimezone();
  const [currentYear, currentMonth] = today.split("-").map(Number);
  const month = req.query.month === undefined ? currentMonth : Number(req.query.month);
  const year = req.query.year === undefined ? currentYear : Number(req.query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ message: "الشهر أو السنة غير صحيح" }); return;
  }
  const student = await Student.findById(id).lean() as any;
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const start = `${prefix}-01`;
  const end = `${prefix}-${new Date(year, month, 0).getDate()}`;
  const scope = { student_id: id, teacher_id: student.teacher_id };
  const [teacher, attendanceRecords, subscriptions, settings, grade, group, examGrades, books, memberships, lastAttendance] = await Promise.all([
    Teacher.findById(student.teacher_id).select("name subject").lean(),
    AttendanceRecord.find({ ...scope, month, year }).sort({ session_date: 1 }).populate("group_id", "name cancelled_sessions").lean(),
    MonthlySubscription.find({ ...scope, $or: [{ year: { $lt: year } }, { year, month: { $lte: month } }] }).select("month year status amount discount paid_at receipt_number").sort({ year: -1, month: -1 }).lean(),
    SystemSettings.findOne().select("site_name site_logo").lean(),
    student.grade_id ? Grade.findById(student.grade_id).select("name").lean() : null,
    student.group_id ? Group.findById(student.group_id).select("name day_of_week time").lean() : null,
    ExamGrade.find({ student_id: id }).select("exam_id score").populate({ path: "exam_id", match: { teacher_id: student.teacher_id }, select: "title max_score exam_date created_at" }).lean(),
    BookSale.find({ ...scope, month, year, status: "active" }).select("book_id price discount final_price is_exempt created_at").populate("book_id", "name").sort({ created_at: 1 }).lean(),
    StudentMembership.find({ ...scope, starts_on: { $lte: end }, $or: [{ ends_on: null }, { ends_on: { $gte: start } }] }).populate("group_id", "name").sort({ starts_on: 1 }).lean(),
    AttendanceRecord.findOne({ ...scope, status: "present", session_date: { $lte: end } }).sort({ session_date: -1 }).select("session_date").lean(),
  ]);
  // A legacy fallback is safe only when there is no membership history at all.
  // An empty month after leaving a group must not resurrect current membership.
  const hasHistory = memberships.length > 0 || !!(student.group_id && await StudentMembership.exists(scope));
  const joinedOn = student.created_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(student.created_at)) : today;
  const attendanceMemberships = hasHistory ? memberships : student.group_id ? [{ group_id: { _id: student.group_id, name: group?.name }, starts_on: joinedOn, ends_on: null }] : [];
  const groupIds = attendanceMemberships.map(m => (m.group_id as any)?._id ?? m.group_id).filter(Boolean);
  const sessions = groupIds.length ? await AttendanceRecord.aggregate([
    { $match: { teacher_id: student.teacher_id, group_id: { $in: groupIds }, month, year, session_date: { $gte: start, $lte: end, $lt: today } } },
    { $group: { _id: { group_id: "$group_id", date: "$session_date" } } },
  ]) : [];
  const resolutions=await effectiveResolutions({...scope,target_date:{$gte:start,$lte:end}});
  const merged=mergeAttendanceResolutions(attendanceRecords,resolutions).map(r=>({...r,group_id:attendanceMemberships.find(m=>String((m.group_id as any)?._id || m.group_id)===String(r.group_id?._id || r.group_id))?.group_id || r.group_id}));
  const attendance = reportAttendance(merged.filter(r=>!r.group_id?.cancelled_sessions?.includes(r.session_date)), attendanceMemberships as any, sessions, today);
  const subscription = subscriptions.find(s => s.month === month && s.year === year);
  const exams = examGrades.filter((row: any) => row.exam_id && row.exam_id.exam_date <= end).map((row: any) => ({ title: row.exam_id.title, date: row.exam_id.exam_date, score: row.score, max_score: row.exam_id.max_score })).sort((a, b) => b.date.localeCompare(a.date));
  const monthlyExams = exams.filter(e => e.date.startsWith(prefix));
  const average = (rows: typeof exams) => { const valid = rows.filter(e => e.score != null && e.max_score > 0); return valid.length ? Math.round(valid.reduce((sum, e) => sum + e.score / e.max_score * 100, 0) / valid.length) : null; };
  const arrears = subscriptions.filter(s => s.status === "due");
  const net = (s: { amount: number; discount?: number }) => Math.max(0, s.amount - (s.discount || 0));
  const lastPaid = subscriptions.find(s => s.status === "paid");
  const lastExam = exams[0];
  const present = attendance.filter(r => r.status === "present").length;
  const absent = attendance.filter(r => r.status === "absent" || r.status==="unrecorded").length;
  res.json({
    id: student._id, name: student.name, code: student.center_student_code || student.code,
    attendance_compensated:attendance.filter(r=>r.status==="compensated").length,attendance_exempt:attendance.filter(r=>r.status==="exempt").length,attendance_guest:attendance.filter(r=>r.status==="guest").length,
    grade_name: grade?.name || "", group_name: group?.name || "", group_day: group?.day_of_week || "", group_time: group?.time || "",
    teacher_name: teacher?.name || "", teacher_subject: teacher?.subject || "", site_name: "منصة نظمها", site_logo: settings?.site_logo || "",
    report_month: month, report_year: year, joined_at: student.created_at,
    subscription_start_month: student.subscription_start_month, subscription_start_year: student.subscription_start_year,
    isPaid: subscription?.status === "paid" || subscription?.status === "exempt", payment_status: subscription?.status || "missing",
    subscription_amount: subscription ? net(subscription) : null, subscription_base: subscription?.amount ?? null, subscription_discount: subscription?.discount ?? 0,
    paid_at: subscription?.paid_at || null, receipt_number: subscription?.receipt_number || null,
    arrears_count: arrears.length, arrears_amount: arrears.reduce((sum, s) => sum + net(s), 0),
    last_paid: lastPaid ? { month: lastPaid.month, year: lastPaid.year, amount: net(lastPaid) } : null,
    attendance_present: present, attendance_absent: absent, attendance_total: present + absent,
    last_attendance: lastAttendance?.session_date || null,
    attendance,
    exams: monthlyExams, exam_average: average(monthlyExams), exam_average_all_time: average(exams),
    last_exam_title: lastExam?.title, last_exam_score: lastExam?.score ?? null, last_exam_max: lastExam?.max_score, last_exam_date: lastExam?.date,
    books: books.map((b: any) => ({ name: b.book_id?.name || "كتاب سابق", price: b.price, discount: b.discount, amount: b.final_price, exempt: b.is_exempt, date: b.created_at })),
    memberships: memberships.map((m: any) => ({ group: m.group_id?.name || "مجموعة سابقة", start: m.starts_on, end: m.ends_on })),
  });
};

/**
 * تقرير عام للطالب داخل السنتر باستخدام center_student_code.
 * يعرض كل المواد/المدرسين المرتبطين بهذا الكود.
 * لا يحتاج توكن — الكود مجرد identifier عام.
 */
export const getPublicCenterStudentReport = async (req: Request, res: Response): Promise<void> => {
  const { centerCode } = req.params;

  // جيب كل Student records بنفس center_student_code
  if (!res.locals.centerStudentId) { res.status(401).json({ message: "غير مصرح" }); return; }
  const studentRecords = await Student.find({ center_student_id: res.locals.centerStudentId, center_student_code: centerCode })
    .select("_id name code grade_id group_id teacher_id center_student_code")
    .lean() as any[];

  if (!studentRecords.length) {
    res.status(404).json({ message: "لم يتم العثور على بيانات الطالب" });
    return;
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // جيب كل البيانات المرتبطة بـ parallel
  const studentIds = studentRecords.map((s: any) => s._id);
  const teacherIds = [...new Set(studentRecords.map((s: any) => String(s.teacher_id)))];
  const gradeIds = [...new Set(studentRecords.map((s: any) => s.grade_id).filter(Boolean))];
  const groupIds = [...new Set(studentRecords.map((s: any) => s.group_id).filter(Boolean))];

  const [teachers, grades, groups, attendanceRecords, subscriptions, settings] = await Promise.all([
    Teacher.find({ _id: { $in: teacherIds } }).select("_id name subject").lean() as Promise<any[]>,
    gradeIds.length ? Grade.find({ _id: { $in: gradeIds } }).select("_id name").lean() as Promise<any[]> : Promise.resolve([]),
    groupIds.length ? Group.find({ _id: { $in: groupIds } }).select("_id name day_of_week time").lean() as Promise<any[]> : Promise.resolve([]),
    AttendanceRecord.find({ student_id: { $in: studentIds }, month, year }).lean() as Promise<any[]>,
    MonthlySubscription.find({ student_id: { $in: studentIds }, month, year }).lean() as Promise<any[]>,
    SystemSettings.findOne().lean() as Promise<any>,
  ]);

  const teacherMap = new Map(teachers.map((t: any) => [String(t._id), t]));
  const gradeMap = new Map((grades as any[]).map((g: any) => [String(g._id), g.name]));
  const groupMap = new Map((groups as any[]).map((g: any) => [String(g._id), g]));
  const centerResolutions=await effectiveResolutions({student_id:{$in:studentIds},target_date:{$gte:`${year}-${String(month).padStart(2,"0")}-01`,$lte:`${year}-${String(month).padStart(2,"0")}-31`}});
  const attendanceByStudent = new Map<string, any[]>();
  for (const r of mergeAttendanceResolutions(attendanceRecords,centerResolutions)) {
    const key = String(r.student_id);
    if (!attendanceByStudent.has(key)) attendanceByStudent.set(key, []);
    attendanceByStudent.get(key)!.push(r);
  }
  const subByStudent = new Map(subscriptions.map((s: any) => [String(s.student_id), s]));

  // بناء التقرير لكل record
  const subjects = studentRecords.map((s: any) => {
    const sid = String(s._id);
    const teacher = teacherMap.get(String(s.teacher_id));
    const group = s.group_id ? groupMap.get(String(s.group_id)) : null;
    const records = attendanceByStudent.get(sid) ?? [];
    const presentCount = records.filter((r: any) => r.status === "present" && !["guest","substitute"].includes(r.attendance_kind)).length;
    const absentCount = records.filter((r: any) => r.status === "absent" && !r.resolution).length;
    const sub = subByStudent.get(sid);
    const isPaid = sub?.status === "paid" || sub?.status === "exempt";
    return {
      student_id: sid,
      teacher_name: teacher?.name ?? "",
      subject: teacher?.subject ?? "",
      group_name: group?.name ?? "",
      group_day: group?.day_of_week ?? "",
      group_time: group?.time ?? "",
      attendance_present: presentCount,
      attendance_absent: absentCount,
      attendance_total: presentCount + absentCount,
      isPaid,
    };
  });

  // بيانات الطالب من أول record
  const first = studentRecords[0];
  res.json({
    center_student_code: centerCode,
    name: first.name,
    grade_name: first.grade_id ? (gradeMap.get(String(first.grade_id)) ?? "") : "",
    site_name: settings?.site_name ?? "نظمها",
    site_logo: settings?.site_logo ?? "",
    subjects,
  });
};
