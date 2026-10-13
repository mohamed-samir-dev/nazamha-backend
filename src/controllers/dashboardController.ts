import { Types } from "mongoose";
import { Response } from "express";
import { Grade } from "../models/Grade";
import { Group } from "../models/Group";
import { Student } from "../models/Student";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { BookSale } from "../models/BookSale";
import { AuthRequest } from "../middleware/auth";
import { Teacher } from "../models/Teacher";

const STUDENT_FIELDS = "name code grade_id group_id received_books months";
const TEACHER_FIELDS = "name email phone is_active is_admin is_super_admin is_center_mode has_bills_feature has_attendance_feature features books banner academic_year subscription_started_at subscription_expires_at monthly_price whatsapp_template plan_id";

// in-memory cache: key → { data, exp }
const dashCache = new Map<string, { data: unknown; exp: number }>();
const CACHE_TTL = 30_000; // 30 ثانية

function cacheKey(teacherId: string, month: number, year: number) {
  return `${teacherId}:${month}:${year}`;
}

export function invalidateDashboardCache(teacherId: string) {
  for (const k of dashCache.keys()) {
    if (k.startsWith(`${teacherId}:`)) dashCache.delete(k);
  }
}

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  // For admin: use first allowed teacher or reject if none
  const isAdmin = req.user!.is_admin;
  const isSuperAdmin = req.user!.is_super_admin;
  const userType = req.user!.user_type;

  let teacherId: string;

  if (userType === "staff") {
    // Assistant: must have effective_teacher_id
    const effectiveId = req.user!.effective_teacher_id;
    if (!effectiveId) {
      res.status(403).json({ message: "هذا الحساب ليس مرتبطاً بمدرس محدد" }); return;
    }
    teacherId = effectiveId;
  } else if (!isAdmin) {
    teacherId = req.user!.id;
  } else if (isSuperAdmin) {
    teacherId = (req.query.teacher_id as string) || req.user!.id;
  } else {
    const allowed = req.user!.allowed_teacher_ids || [];
    const requested = req.query.teacher_id as string;
    if (requested && !allowed.includes(requested)) {
      res.status(403).json({ message: "ليس لديك صلاحية لعرض بيانات هذا المدرس" });
      return;
    }
    teacherId = requested || allowed[0];
    if (!teacherId) {
      res.status(403).json({ message: "لا يوجد مدرسون مسموح بهم" });
      return;
    }
  }

  // Block admin from accessing hidden teachers
  if (isAdmin && !isSuperAdmin) {
    const t = await Teacher.findById(teacherId).select("hidden_from_admin").lean();
    if ((t as any)?.hidden_from_admin) {
      res.status(403).json({ message: "ليس لديك صلاحية لعرض بيانات هذا المدرس" });
      return;
    }
  }

  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year  = Number(req.query.year)  || now.getFullYear();

  const summaryOnly = req.query.summary === "1";
  const key = cacheKey(teacherId, month, year) + ":" + JSON.stringify(req.user!.staff_permissions ?? null) + ":" + summaryOnly;
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) { res.status(400).json({ message: "فترة غير صالحة" }); return; }
  for (const [k, v] of dashCache) if (v.exp <= Date.now()) dashCache.delete(k);
  const cached = dashCache.get(key);
  if (req.query.refresh !== "1" && cached && cached.exp > Date.now()) {
    res.json(cached.data);
    return;
  }

  const [teacher, grades, groups, studentsRaw, subscriptions, attendanceRaw, totalBooksDelivered, studentCounts, paymentCounts] = await Promise.all([
    Teacher.findById(teacherId).lean(),
    Grade.find({ teacher_id: teacherId }).lean(),
    Group.find({ teacher_id: teacherId }).sort({ created_at: -1 }).lean(),
    summaryOnly ? Promise.resolve([]) : Student.find({ teacher_id: teacherId }).select(STUDENT_FIELDS).lean(),
    summaryOnly ? Promise.resolve([]) : MonthlySubscription.find({ teacher_id: teacherId, month, year }).lean(),
    AttendanceRecord.aggregate([
      { $match: { teacher_id: new Types.ObjectId(teacherId), status: "present" } },
      { $group: { _id: { group_id: "$group_id", session_date: "$session_date" }, presentCount: { $sum: 1 } } },
      { $sort: { "_id.session_date": -1, "_id.group_id": 1 } },
      { $lookup: { from: "groups", localField: "_id.group_id", foreignField: "_id", as: "group" } },
      { $match: { "group.teacher_id": new Types.ObjectId(teacherId) } },
      { $limit: 5 },
      { $project: { group: 0 } },
    ]),
    BookSale.countDocuments({ teacher_id: teacherId, status: "active" }),
    summaryOnly ? Student.aggregate([{ $match:{teacher_id:new Types.ObjectId(teacherId)} },{$group:{_id:"$group_id",count:{$sum:1}}}]) : Promise.resolve([]),
    summaryOnly ? MonthlySubscription.aggregate([{$match:{teacher_id:new Types.ObjectId(teacherId),month,year}},{$lookup:{from:"students",localField:"student_id",foreignField:"_id",as:"student"}},{$match:{"student.teacher_id":new Types.ObjectId(teacherId)}},{$group:{_id:"$status",count:{$sum:1}}}]) : Promise.resolve([]),
  ]);

  const students   = studentsRaw.map((s: any) => ({ ...s, id: s._id.toString(), group_id: s.group_id?.toString() ?? null, grade_id: s.grade_id?.toString() ?? null }));
  const attendance = attendanceRaw.filter((a: any) => groups.some(g => g._id.toString() === a._id.group_id?.toString())).slice(0, 5).map((a: any) => ({ group_id: a._id.group_id.toString(), session_date: a._id.session_date, presentCount: a.presentCount }));
  const groupCounts = new Map(studentCounts.map((row:any)=>[String(row._id),row.count]));
  const groupsMapped = (groups as any[]).map((g: any) => ({ ...g, ...(summaryOnly ? {student_count:groupCounts.get(String(g._id)) || 0} : {}), id: g._id.toString(), grade_id: g.grade_id?.toString() ?? null }));

  if (!teacher) {
    res.status(404).json({ message: "المدرس غير موجود" });
    return;
  }

  const t = teacher as any;
  const mappedTeacher = {
    ...t,
    id: t._id?.toString(),
    user_type: "teacher",
    ...(userType === "staff" ? { effective_teacher_id: req.user!.effective_teacher_id } : {}),
    is_admin: false,
    is_center_mode: t.is_center_mode ?? false,
    has_bills_feature: t.has_bills_feature ?? t.features?.bills ?? false,
    has_attendance_feature: t.has_attendance_feature ?? t.features?.attendance ?? true,
    has_centers_feature: t.features?.centers ?? false,
    subscription_started_at: t.subscription_started_at ?? t.subscription?.started_at ?? null,
    subscription_expires_at: t.subscription_expires_at ?? t.subscription?.expires_at ?? null,
    ...(userType === "staff" ? { teacher_id: req.user!.effective_teacher_id } : {}),
  };
  const permissions = req.user!.staff_permissions;
  const finances = !permissions || permissions.includes("payments") || permissions.includes("reports");
  const safeStudents = finances ? students : students.map(({ months, received_books, ...student }) => student);
  const totals = summaryOnly ? {totalStudents:studentCounts.reduce((sum:number,row:any)=>sum+row.count,0),paid:finances ? paymentCounts.filter((row:any)=>["paid","exempt"].includes(row._id)).reduce((sum:number,row:any)=>sum+row.count,0) : 0,due:finances ? paymentCounts.find((row:any)=>row._id==="due")?.count || 0 : 0} : undefined;
  const payload = { totals, teacher: mappedTeacher, grades: grades.map(g => ({ ...g, id: g._id.toString() })), groups: groupsMapped, students: safeStudents,
    subscriptions: finances ? subscriptions : [], attendance: !permissions || permissions.includes("attendance") || permissions.includes("reports") ? attendance : [], totalBooksDelivered: finances ? totalBooksDelivered : 0 };
  if (dashCache.size >= 500) dashCache.delete(dashCache.keys().next().value!);
  dashCache.set(key, { data: payload, exp: Date.now() + CACHE_TTL });

  res.json(payload);
};

export const getDashboardPayments = async (req: AuthRequest, res: Response): Promise<void> => {
  const isAdmin = req.user!.is_admin;
  const isSuperAdmin = req.user!.is_super_admin;
  const userType = req.user!.user_type;

  let teacherId: string;
  if (userType === "staff") {
    const effectiveId = req.user!.effective_teacher_id;
    if (!effectiveId) { res.status(403).json({ message: "هذا الحساب ليس مرتبطاً بمدرس محدد" }); return; }
    teacherId = effectiveId;
  } else if (!isAdmin) {
    teacherId = req.user!.id;
  } else if (isSuperAdmin) {
    teacherId = (req.query.teacher_id as string) || req.user!.id;
  } else {
    const allowed = req.user!.allowed_teacher_ids || [];
    const requested = req.query.teacher_id as string;
    if (requested && !allowed.includes(requested)) {
      res.status(403).json({ message: "ليس لديك صلاحية لعرض بيانات هذا المدرس" });
      return;
    }
    teacherId = requested || allowed[0];
    if (!teacherId) { res.status(403).json({ message: "لا يوجد مدرسون مسموح بهم" }); return; }
  }

  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year  = Number(req.query.year)  || now.getFullYear();

  if (!Number.isInteger(month) || month<1 || month>12 || !Number.isInteger(year) || year<2000 || year>2100) {res.status(400).json({message:"فترة غير صالحة"});return;}
  if (isAdmin && !isSuperAdmin && (await Teacher.findById(teacherId).select("hidden_from_admin").lean() as any)?.hidden_from_admin) {res.status(403).json({message:"غير مصرح"});return;}
  if (req.query.unpaid === "1") {
    const page = Math.max(1,Math.min(100000,Math.floor(Number(req.query.page)||1)));
    const rows = await MonthlySubscription.aggregate([
      {$match:{teacher_id:new Types.ObjectId(teacherId),month,year,status:"due"}},
      {$lookup:{from:"students",localField:"student_id",foreignField:"_id",as:"student"}},{$unwind:"$student"},
      {$match:{"student.teacher_id":new Types.ObjectId(teacherId)}},{$sort:{"student.name":1,"student._id":1}},
      {$facet:{total:[{$count:"count"}],students:[{$skip:(page-1)*50},{$limit:50},
        {$lookup:{from:"groups",localField:"student.group_id",foreignField:"_id",as:"group"}},
        {$lookup:{from:"grades",localField:"student.grade_id",foreignField:"_id",as:"grade"}},
        {$project:{_id:0,id:{$toString:"$student._id"},name:"$student.name",code:"$student.code",groupName:{$arrayElemAt:["$group.name",0]},gradeName:{$arrayElemAt:["$grade.name",0]}}}]}}
    ]);
    res.json({students:rows[0]?.students||[],total:rows[0]?.total[0]?.count||0,page,limit:50});return;
  }

  const [studentsRaw, subscriptions] = await Promise.all([
    Student.find({ teacher_id: teacherId }).select(STUDENT_FIELDS).lean(),
    MonthlySubscription.find({ teacher_id: teacherId, month, year }).lean(),
  ]);

  const students = studentsRaw.map((s: any) => ({ ...s, id: s._id.toString(), group_id: s.group_id?.toString() ?? null, grade_id: s.grade_id?.toString() ?? null }));

  res.json({ students, subscriptions });
};
