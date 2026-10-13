import { Request, Response } from "express";
import { Student } from "../models/Student";
import { Teacher } from "../models/Teacher";
import { Group } from "../models/Group";
import { Grade } from "../models/Grade";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { Exam, ExamGrade } from "../models/Exam";
import { SystemSettings } from "../models/SystemSettings";

export const getPublicStudentReport = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const student = await Student.findById(id).lean() as any;
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [
    teacher,
    attendanceRecords,
    subscription,
    settings,
    grade,
    group,
    lastGrade,
  ] = await Promise.all([
    Teacher.findById(student.teacher_id).select("name").lean() as Promise<any>,
    AttendanceRecord.find({ student_id: id, month, year }).lean() as Promise<any[]>,
    MonthlySubscription.findOne({ student_id: id, month, year }).lean() as Promise<any>,
    SystemSettings.findOne().lean() as Promise<any>,
    student.grade_id
      ? Grade.findById(student.grade_id).select("name").lean() as Promise<any>
      : Promise.resolve(null),
    student.group_id
      ? Group.findById(student.group_id).select("name day_of_week time").lean() as Promise<any>
      : Promise.resolve(null),
    ExamGrade.findOne({ student_id: id })
      .sort({ created_at: -1 })
      .lean() as Promise<any>,
  ]);

  const lastExam = lastGrade
    ? await Exam.findById(lastGrade.exam_id).lean() as any
    : null;

  const presentCount = (attendanceRecords as any[]).filter((r: any) => r.status === "present").length;
  const absentCount = (attendanceRecords as any[]).filter((r: any) => r.status === "absent").length;
  const isPaid = subscription?.status === "paid" || subscription?.status === "exempt";

  res.json({
    id: student._id,
    name: student.name,
    code: student.code,
    grade_name: grade?.name || "",
    group_name: group?.name || "",
    group_day: group?.day_of_week || "",
    group_time: group?.time || "",
    teacher_name: teacher?.name || "",
    site_name: settings?.site_name || "نظمها",
    site_logo: settings?.site_logo || "",
    isPaid,
    attendance_present: presentCount,
    attendance_absent: absentCount,
    attendance_total: presentCount + absentCount,
    last_exam_title: lastExam?.title,
    last_exam_score: lastGrade?.score ?? null,
    last_exam_max: lastExam?.max_score,
    last_exam_date: lastExam?.exam_date,
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
  const attendanceByStudent = new Map<string, any[]>();
  for (const r of attendanceRecords) {
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
    const presentCount = records.filter((r: any) => r.status === "present").length;
    const absentCount = records.filter((r: any) => r.status === "absent").length;
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
