import { Response } from "express";
import { Center } from "../models/Center";
import { CenterStaff, ALL_STAFF_PERMISSIONS, StaffPermission } from "../models/CenterStaff";
import { Teacher } from "../models/Teacher";
import { AuditLog } from "../models/AuditLog";
import { AuthRequest, invalidateTokenCache } from "../middleware/auth";

const MAX_FAILED_ATTEMPTS = 5;

// ── Admin: CRUD Centers ───────────────────────────────────────────────────────

export const getCenters = async (_req: AuthRequest, res: Response): Promise<void> => {
  const centers = await Center.find({ deleted_at: null }).sort({ created_at: -1 }).lean();
  const centerIds = centers.map((c: any) => c._id);

  const [teacherCounts, staffCounts] = await Promise.all([
    Teacher.aggregate([
      { $match: { center_id: { $in: centerIds }, deleted_at: null } },
      { $group: { _id: "$center_id", count: { $sum: 1 } } },
    ]),
    CenterStaff.aggregate([
      { $match: { center_id: { $in: centerIds }, deleted_at: null } },
      { $group: { _id: "$center_id", count: { $sum: 1 } } },
    ]),
  ]);

  const teacherMap = new Map(teacherCounts.map((t: any) => [t._id.toString(), t.count]));
  const staffMap = new Map(staffCounts.map((s: any) => [s._id.toString(), s.count]));

  const result = centers.map((c: any) => ({
    ...c,
    id: c._id.toString(),
    teachers_count: teacherMap.get(c._id.toString()) || 0,
    staff_count: staffMap.get(c._id.toString()) || 0,
  }));

  res.json(result);
};

export const getCenterById = async (req: AuthRequest, res: Response): Promise<void> => {
  const center = await Center.findOne({ _id: req.params.id, deleted_at: null }).lean();
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }

  const [teachers, staff] = await Promise.all([
    Teacher.find({ center_id: req.params.id, deleted_at: null }).select("-password -refresh_token -email_verification_token").lean(),
    CenterStaff.find({ center_id: req.params.id, deleted_at: null }).lean(),
  ]);

  res.json({ ...(center as any), id: (center as any)._id.toString(), teachers, staff });
};

export const createCenter = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, email, password, phone, address } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ message: "الاسم والبريد وكلمة المرور مطلوبة" }); return;
  }

  let center;
  try {
    center = await Center.create({ name: name.trim(), email: email.toLowerCase().trim(), password, phone: phone?.trim(), address: address?.trim() });
  } catch (err: any) {
    if (err.code === 11000) { res.status(400).json({ message: "البريد الإلكتروني مستخدم بالفعل" }); return; }
    throw err;
  }

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Admin",
    action: "center.create",
    resource_type: "Center",
    resource_id: (center._id as any).toString(),
    new_data: { name, email },
    ip_address: req.ip,
  });

  res.status(201).json({ ...(center as any).toJSON(), id: (center._id as any).toString() });
};

export const updateCenter = async (req: AuthRequest, res: Response): Promise<void> => {
  const allowed = ["name", "phone", "address", "manager_name", "whatsapp", "governorate"];
  req.body = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));

  const center = await Center.findOneAndUpdate(
    { _id: req.params.id, deleted_at: null },
    req.body,
    { new: true, runValidators: true }
  );
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Admin",
    action: "center.update",
    resource_type: "Center",
    resource_id: req.params.id,
    new_data: req.body,
    ip_address: req.ip,
  });

  res.json(center);
};

export const toggleCenterStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const center = await Center.findOne({ _id: req.params.id, deleted_at: null });
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }

  center.is_active = !center.is_active;
  await center.save({ validateBeforeSave: false });
  invalidateTokenCache(center._id.toString());

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Admin",
    action: center.is_active ? "center.activate" : "center.deactivate",
    resource_type: "Center",
    resource_id: req.params.id,
    ip_address: req.ip,
  });

  res.json({ is_active: center.is_active });
};

export const resetCenterPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400).json({ message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }); return;
  }
  const center = await Center.findOne({ _id: req.params.id, deleted_at: null });
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }

  center.password = password;
  center.failed_login_attempts = 0;
  await center.save();
  invalidateTokenCache(center._id.toString());

  res.json({ message: "تم تغيير كلمة المرور بنجاح" });
};

export const deleteCenter = async (req: AuthRequest, res: Response): Promise<void> => {
  const center = await Center.findOneAndUpdate(
    { _id: req.params.id, deleted_at: null },
    { deleted_at: new Date(), is_active: false },
    { new: true }
  );
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }
  invalidateTokenCache(center._id.toString());

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Admin",
    action: "center.delete",
    resource_type: "Center",
    resource_id: req.params.id,
    new_data: { name: center.name },
    ip_address: req.ip,
  });

  res.json({ message: "تم حذف السنتر بنجاح" });
};

export const getCenterStats = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.params.id;
  const center = await Center.findOne({ _id: centerId, deleted_at: null }).lean();
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }

  const teachers = await Teacher.find({ center_id: centerId, deleted_at: null }).select("_id").lean();
  const teacherIds = teachers.map((t: any) => t._id);

  const { Student } = await import("../models/Student");
  const { Group } = await import("../models/Group");
  const { AttendanceRecord } = await import("../models/AttendanceRecord");

  const today = new Date().toISOString().split("T")[0];

  const [studentsCount, groupsCount, assistantsCount, todayPresent, todayAbsent] = await Promise.all([
    Student.countDocuments({ teacher_id: { $in: teacherIds } }),
    Group.countDocuments({ teacher_id: { $in: teacherIds } }),
    CenterStaff.countDocuments({ center_id: centerId, teacher_id: { $ne: null }, deleted_at: null }),
    AttendanceRecord.countDocuments({ teacher_id: { $in: teacherIds }, session_date: today, status: "present" }),
    AttendanceRecord.countDocuments({ teacher_id: { $in: teacherIds }, session_date: today, status: "absent" }),
  ]);

  res.json({
    teachers_count: teacherIds.length,
    assistants_count: assistantsCount,
    students_count: studentsCount,
    groups_count: groupsCount,
    today_present: todayPresent,
    today_absent: todayAbsent,
  });
};

// ── Center: manage own teachers ───────────────────────────────────────────────

export const getCenterTeachers = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { Student } = await import("../models/Student");
  const mongoose = (await import("mongoose")).default;

  const teachers = await Teacher.find({ center_id: centerId, deleted_at: null })
    .select("_id name email phone subject is_active center_id created_at")
    .sort({ created_at: -1 })
    .lean();

  const teacherObjectIds = teachers.map((t: any) => new mongoose.Types.ObjectId(t._id));
  const studentCounts = teacherObjectIds.length
    ? await Student.aggregate([
        { $match: { teacher_id: { $in: teacherObjectIds } } },
        { $group: { _id: "$teacher_id", count: { $sum: 1 } } },
      ])
    : [];

  const studentMap = new Map(studentCounts.map((x: any) => [x._id.toString(), x.count]));

  res.json(teachers.map((t: any) => ({
    ...t,
    id: t._id.toString(),
    students_count: studentMap.get(t._id.toString()) || 0,
  })));
};

export const createCenterTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { name, email, password, phone, subject } = req.body;

  const trimmedName = (name || "").trim();
  const trimmedEmail = (email || "").trim().toLowerCase();
  const trimmedPhone = (phone || "").trim();
  const trimmedSubject = (subject || "").trim();

  if (!trimmedName) { res.status(400).json({ message: "الاسم مطلوب" }); return; }
  if (trimmedName.length < 2) { res.status(400).json({ message: "الاسم يجب أن يكون حرفين على الأقل" }); return; }
  if (trimmedName.length > 100) { res.status(400).json({ message: "الاسم طويل جداً" }); return; }
  if (!trimmedEmail) { res.status(400).json({ message: "البريد الإلكتروني مطلوب" }); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) { res.status(400).json({ message: "البريد الإلكتروني غير صحيح" }); return; }
  if (trimmedEmail.length > 254) { res.status(400).json({ message: "البريد الإلكتروني طويل جداً" }); return; }
  if (!password) { res.status(400).json({ message: "كلمة المرور مطلوبة" }); return; }
  if (password.length < 8) { res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return; }
  if (password.length > 128) { res.status(400).json({ message: "كلمة المرور طويلة جداً" }); return; }
  if (trimmedPhone && !/^[\d\s\+\-\(\)]{7,20}$/.test(trimmedPhone)) {
    res.status(400).json({ message: "رقم الهاتف غير صحيح" }); return;
  }
  if (trimmedSubject && trimmedSubject.length > 100) { res.status(400).json({ message: "اسم المادة طويل جداً" }); return; }

  let teacher;
  try {
    teacher = await Teacher.create({
      name: trimmedName,
      email: trimmedEmail,
      password,
      phone: trimmedPhone || undefined,
      subject: trimmedSubject || undefined,
      center_id: centerId,
      is_active: true,
      subscription_price: 0,
      has_bills_feature: false,
      has_attendance_feature: true,
      is_center_mode: false,
      subscription_started_at: new Date(),
      subscription_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  } catch (err: any) {
    if (err.code === 11000) { res.status(400).json({ message: "البريد الإلكتروني مستخدم بالفعل" }); return; }
    throw err;
  }

  // Invalidate center token cache so new teacher appears in center_teacher_ids
  invalidateTokenCache(centerId);

  res.status(201).json({
    id: (teacher._id as any).toString(),
    name: (teacher as any).name,
    email: (teacher as any).email,
    phone: (teacher as any).phone ?? null,
    subject: (teacher as any).subject ?? null,
    is_active: (teacher as any).is_active,
    center_id: centerId,
    created_at: (teacher as any).created_at,
  });
};

export const updateCenterTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;

  // Allowlist only safe fields
  const { name, phone, subject, is_active } = req.body;
  const updates: Record<string, unknown> = {};

  if (name !== undefined) {
    const trimmed = (name || "").trim();
    if (!trimmed || trimmed.length < 2) { res.status(400).json({ message: "الاسم يجب أن يكون حرفين على الأقل" }); return; }
    if (trimmed.length > 100) { res.status(400).json({ message: "الاسم طويل جداً" }); return; }
    updates.name = trimmed;
  }
  if (phone !== undefined) {
    const trimmed = (phone || "").trim();
    if (trimmed && !/^[\d\s\+\-\(\)]{7,20}$/.test(trimmed)) { res.status(400).json({ message: "رقم الهاتف غير صحيح" }); return; }
    updates.phone = trimmed || undefined;
  }
  if (subject !== undefined) {
    const trimmed = (subject || "").trim();
    if (trimmed.length > 100) { res.status(400).json({ message: "اسم المادة طويل جداً" }); return; }
    updates.subject = trimmed || undefined;
  }
  if (is_active !== undefined) updates.is_active = Boolean(is_active);

  const teacher = await Teacher.findOneAndUpdate(
    { _id: req.params.teacherId, center_id: centerId, deleted_at: null },
    updates,
    { new: true, runValidators: true }
  );
  if (!teacher) { res.status(404).json({ message: "المدرس غير موجود" }); return; }

  if (is_active !== undefined) invalidateTokenCache(teacher._id.toString());

  res.json({
    id: (teacher._id as any).toString(),
    name: (teacher as any).name,
    email: (teacher as any).email,
    phone: (teacher as any).phone ?? null,
    subject: (teacher as any).subject ?? null,
    is_active: (teacher as any).is_active,
    center_id: (teacher as any).center_id?.toString() ?? null,
    created_at: (teacher as any).created_at,
  });
};

export const resetCenterTeacherPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { password } = req.body;
  if (!password || password.length < 8) {
    res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return;
  }
  if (password.length > 128) {
    res.status(400).json({ message: "كلمة المرور طويلة جداً" }); return;
  }

  const teacher = await Teacher.findOne({ _id: req.params.teacherId, center_id: centerId, deleted_at: null }).select("+password");
  if (!teacher) { res.status(404).json({ message: "المدرس غير موجود" }); return; }

  teacher.password = password;
  teacher.failed_login_attempts = 0;
  await teacher.save();
  invalidateTokenCache(teacher._id.toString());

  res.json({ message: "تم تغيير كلمة المرور بنجاح" });
};

export const getCenterTeacherStats = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { teacherId } = req.params;

  // Security: verify teacher belongs to this center
  const teacher = await Teacher.findOne({ _id: teacherId, center_id: centerId, deleted_at: null })
    .select("_id name email phone subject is_active created_at")
    .lean();
  if (!teacher) { res.status(404).json({ message: "المدرس غير موجود" }); return; }

  const { Student } = await import("../models/Student");
  const { Group } = await import("../models/Group");
  const { AttendanceRecord } = await import("../models/AttendanceRecord");
  const mongoose = (await import("mongoose")).default;

  const teacherOid = new mongoose.Types.ObjectId(teacherId);
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  // Start of current month for sessions count
  const monthStart = new Date(curYear, curMonth - 1, 1).toISOString().slice(0, 10);
  const monthEnd = new Date(curYear, curMonth, 0).toISOString().slice(0, 10);

  const [
    studentsCount,
    suspendedCount,
    groups,
    attendanceThisMonth,
    recentStudents,
  ] = await Promise.all([
    Student.countDocuments({ teacher_id: teacherOid }),
    Student.countDocuments({ teacher_id: teacherOid, is_suspended: true }),
    Group.find({ teacher_id: teacherOid }).select("_id name day_of_week time grade_id sessions_per_month").lean(),
    AttendanceRecord.aggregate([
      { $match: { teacher_id: teacherOid, month: curMonth, year: curYear } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Student.find({ teacher_id: teacherOid })
      .sort({ created_at: -1 })
      .limit(5)
      .select("_id name group_id is_suspended created_at")
      .lean(),
  ]);

  // Sessions this month = distinct session_dates
  const sessionDates = await AttendanceRecord.distinct("session_date", {
    teacher_id: teacherOid,
    session_date: { $gte: monthStart, $lte: monthEnd },
  });

  // Attendance stats
  const presentCount = (attendanceThisMonth.find((x: any) => x._id === "present") as any)?.count ?? 0;
  const absentCount = (attendanceThisMonth.find((x: any) => x._id === "absent") as any)?.count ?? 0;
  const totalAttendance = presentCount + absentCount;
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : null;

  // Per-group student counts
  const groupIds = groups.map((g: any) => g._id);
  const groupStudentCounts = groupIds.length
    ? await Student.aggregate([
        { $match: { teacher_id: teacherOid, group_id: { $in: groupIds } } },
        { $group: { _id: "$group_id", count: { $sum: 1 } } },
      ])
    : [];
  const groupCountMap = new Map((groupStudentCounts as any[]).map((x: any) => [x._id.toString(), x.count]));

  // Populate group_id name for recent students
  const groupNameMap = new Map((groups as any[]).map((g: any) => [g._id.toString(), g.name]));

  res.json({
    students_count: studentsCount,
    suspended_count: suspendedCount,
    active_students_count: studentsCount - suspendedCount,
    groups_count: groups.length,
    sessions_this_month: sessionDates.length,
    attendance_rate: attendanceRate,
    present_count: presentCount,
    absent_count: absentCount,
    groups: (groups as any[]).map((g: any) => ({
      id: g._id.toString(),
      name: g.name,
      day_of_week: g.day_of_week,
      time: g.time,
      students_count: groupCountMap.get(g._id.toString()) ?? 0,
    })),
    recent_students: (recentStudents as any[]).map((s: any) => ({
      id: s._id.toString(),
      name: s.name,
      group_id: s.group_id?.toString() ?? null,
      group_name: s.group_id ? (groupNameMap.get(s.group_id.toString()) ?? null) : null,
      is_suspended: s.is_suspended ?? false,
      created_at: s.created_at,
    })),
  });
};

export const removeCenterTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  // Soft delete: set deleted_at
  const teacher = await Teacher.findOneAndUpdate(
    { _id: req.params.teacherId, center_id: centerId, deleted_at: null },
    { deleted_at: new Date(), is_active: false },
    { new: true }
  );
  if (!teacher) { res.status(404).json({ message: "المدرس غير موجود" }); return; }
  invalidateTokenCache(centerId);
  invalidateTokenCache(teacher._id.toString());
  res.json({ message: "تم حذف المدرس بنجاح" });
};

// ── Center: manage own staff ──────────────────────────────────────────────────

export const getCenterStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  // Support both ?teacher_id=X query param and /teachers/:teacherId/assistants route param
  const teacherIdFilter = req.params.teacherId || (req.query.teacher_id as string) || null;
  const search = (req.query.search as string || "").trim();
  const statusFilter = req.query.status as string | undefined;

  const filter: Record<string, unknown> = { center_id: centerId, deleted_at: null };
  if (teacherIdFilter) filter.teacher_id = teacherIdFilter;
  if (statusFilter === "active") filter.is_active = true;
  else if (statusFilter === "inactive") filter.is_active = false;

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;

  const [staff, total] = await Promise.all([
    CenterStaff.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    CenterStaff.countDocuments(filter),
  ]);

  // Populate teacher names in one batch query
  const teacherIds = [...new Set(staff.map((s: any) => s.teacher_id?.toString()).filter(Boolean))];
  const teachers = teacherIds.length
    ? await Teacher.find({ _id: { $in: teacherIds } }).select("_id name subject").lean()
    : [];
  const teacherMap = new Map(teachers.map((t: any) => [t._id.toString(), { name: t.name, subject: t.subject ?? null }]));

  res.json({
    data: staff.map((s: any) => ({
      ...s,
      id: s._id.toString(),
      teacher_id: s.teacher_id?.toString() ?? null,
      teacher_name: teacherMap.get(s.teacher_id?.toString())?.name ?? null,
      teacher_subject: teacherMap.get(s.teacher_id?.toString())?.subject ?? null,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
};

export const createCenterStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { name, email, password, permissions = [], teacher_id } = req.body;

  const trimmedName = (name || "").trim();
  const trimmedEmail = (email || "").trim().toLowerCase();

  if (!trimmedName || trimmedName.length < 2) { res.status(400).json({ message: "الاسم يجب أن يكون حرفين على الأقل" }); return; }
  if (trimmedName.length > 100) { res.status(400).json({ message: "الاسم طويل جداً" }); return; }
  if (!trimmedEmail) { res.status(400).json({ message: "البريد الإلكتروني مطلوب" }); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) { res.status(400).json({ message: "البريد الإلكتروني غير صحيح" }); return; }
  if (!password || password.length < 8) { res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return; }
  

  // Verify teacher belongs to this center (IDOR protection)
  const teacher = teacher_id ? await Teacher.findOne({ _id: teacher_id, center_id: centerId, deleted_at: null }).select("_id").lean() : null;
  if (teacher_id && !teacher) {
    res.status(400).json({ message: "المدرس غير موجود أو لا ينتمي لهذا السنتر" }); return;
  }

  if (!Array.isArray(permissions)) { res.status(400).json({ message: "صلاحيات غير صالحة" }); return; }
  const validPerms = (permissions as string[]).filter((p) => ALL_STAFF_PERMISSIONS.includes(p as StaffPermission));

  let staff;
  try {
    staff = await CenterStaff.create({
      name: trimmedName,
      email: trimmedEmail,
      password,
      center_id: centerId,
      teacher_id: teacher_id || null,
      permissions: validPerms,
    });
  } catch (err: any) {
    if (err.code === 11000) { res.status(400).json({ message: "البريد الإلكتروني مستخدم بالفعل" }); return; }
    throw err;
  }

  res.status(201).json({ ...(staff as any).toJSON(), id: (staff._id as any).toString(), teacher_id: (staff as any).teacher_id?.toString() ?? null });
};

export const updateCenterStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  // Allowlist: only name is editable via this endpoint
  // is_active → use /toggle-status, teacher_id → use /transfer
  const { name, permissions } = req.body;
  if (permissions !== undefined && (!Array.isArray(permissions) || permissions.some((p: StaffPermission) => !ALL_STAFF_PERMISSIONS.includes(p)))) { res.status(400).json({ message: "صلاحيات غير صالحة" }); return; }

  const trimmedName = (name || "").trim();
  if (!trimmedName || trimmedName.length < 2) {
    res.status(400).json({ message: "الاسم يجب أن يكون حرفين على الأقل" }); return;
  }
  if (trimmedName.length > 100) {
    res.status(400).json({ message: "الاسم طويل جداً" }); return;
  }

  const staff = await CenterStaff.findOneAndUpdate(
    { _id: req.params.staffId, center_id: centerId, deleted_at: null },
    { name: trimmedName, ...(permissions !== undefined ? { permissions } : {}) },
    { new: true, runValidators: true }
  );
  if (!staff) { res.status(404).json({ message: "الموظف غير موجود" }); return; }

  res.json({ ...(staff as any).toJSON(), id: (staff._id as any).toString(), teacher_id: (staff as any).teacher_id?.toString() ?? null });
};

export const resetStaffPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { password } = req.body;
  if (!password || password.length < 8) {
    res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return;
  }
  if (password.length > 128) {
    res.status(400).json({ message: "كلمة المرور طويلة جداً" }); return;
  }

  const staff = await CenterStaff.findOne({ _id: req.params.staffId, center_id: centerId, deleted_at: null }).select("+password");
  if (!staff) { res.status(404).json({ message: "الموظف غير موجود" }); return; }

  staff.password = password;
  staff.failed_login_attempts = 0;
  await staff.save();
  invalidateTokenCache(staff._id.toString());

  res.json({ message: "تم تغيير كلمة المرور بنجاح" });
};

export const toggleCenterStaffStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const staff = await CenterStaff.findOne({ _id: req.params.staffId, center_id: centerId, deleted_at: null });
  if (!staff) { res.status(404).json({ message: "المساعد غير موجود" }); return; }

  staff.is_active = !staff.is_active;
  await staff.save({ validateBeforeSave: false });
  invalidateTokenCache(staff._id.toString());

  res.json({ is_active: staff.is_active, message: staff.is_active ? "تم تفعيل المساعد" : "تم تعطيل المساعد" });
};

export const deleteCenterStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const staff = await CenterStaff.findOneAndUpdate(
    { _id: req.params.staffId, center_id: centerId, deleted_at: null },
    { deleted_at: new Date(), is_active: false },
    { new: true }
  );
  if (!staff) { res.status(404).json({ message: "الموظف غير موجود" }); return; }
  invalidateTokenCache(staff._id.toString());
  res.json({ message: "تم حذف الموظف بنجاح" });
};

export const transferAssistant = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { staffId } = req.params;
  const { teacher_id: newTeacherId } = req.body;

  if (!newTeacherId) {
    res.status(400).json({ message: "teacher_id مطلوب" }); return;
  }

  const [staff, newTeacher] = await Promise.all([
    CenterStaff.findOne({ _id: staffId, center_id: centerId, deleted_at: null }),
    Teacher.findOne({ _id: newTeacherId, center_id: centerId, deleted_at: null }).select("_id name"),
  ]);

  if (!staff) { res.status(404).json({ message: "المساعد غير موجود أو لا ينتمي لهذا السنتر" }); return; }
  if (!newTeacher) { res.status(404).json({ message: "المدرس غير موجود أو لا ينتمي لهذا السنتر" }); return; }

  const oldTeacherId = (staff as any).teacher_id?.toString() ?? null;

  (staff as any).teacher_id = newTeacherId;
  await staff.save({ validateBeforeSave: false });
  invalidateTokenCache(staff._id.toString());

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Center Owner",
    action: "center.staff.transfer",
    resource_type: "CenterStaff",
    resource_id: staffId,
    old_data: { teacher_id: oldTeacherId },
    new_data: { teacher_id: newTeacherId, teacher_name: (newTeacher as any).name },
    ip_address: req.ip,
  });

  res.json({ message: "تم نقل المساعد بنجاح", teacher_id: newTeacherId });
};

export const getCenterFinancialReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const teacherIds = req.user!.center_teacher_ids || [];

  if (teacherIds.length === 0) {
    res.json({ teachers: [], totals: { revenue: 0, subscriptions: 0, book_sales: 0, transactions: 0 } });
    return;
  }

  const { MonthlySubscription } = await import("../models/MonthlySubscription");
  const { BookSale } = await import("../models/BookSale");
  const { Student } = await import("../models/Student");
  const mongoose = (await import("mongoose")).default;

  // ── Resolve scoped teacher list ───────────────────────────────────────────
  let scopedTeacherIds: string[];
  if (req.query.teacher_id) {
    const reqTeacherId = req.query.teacher_id as string;
    if (!teacherIds.includes(reqTeacherId)) {
      res.status(403).json({ message: "غير مصرح" }); return;
    }
    scopedTeacherIds = [reqTeacherId];
  } else {
    scopedTeacherIds = teacherIds;
  }
  const teacherObjectIds = scopedTeacherIds.map((id) => new mongoose.Types.ObjectId(id));

  // ── Build date filters ────────────────────────────────────────────────────
  // paid_at filter for MonthlySubscription
  const subDateFilter: Record<string, unknown> = {};
  // created_at filter for BookSale (BookSale has no paid_at field)
  const bookDateFilter: Record<string, unknown> = {};

  if (req.query.from || req.query.to) {
    const fromDate = req.query.from
      ? new Date((req.query.from as string) + "T00:00:00.000Z")
      : undefined;
    // End of day: use start of next day with $lt to include the full last day
    const toDate = req.query.to
      ? new Date((req.query.to as string) + "T23:59:59.999Z")
      : undefined;

    if (fromDate) { subDateFilter.$gte = fromDate; bookDateFilter.$gte = fromDate; }
    if (toDate)   { subDateFilter.$lte = toDate;   bookDateFilter.$lte = toDate; }
  }

  const hasPaidAtFilter = Object.keys(subDateFilter).length > 0;
  const hasBookDateFilter = Object.keys(bookDateFilter).length > 0;

  const subMatch: Record<string, unknown> = {
    teacher_id: { $in: teacherObjectIds },
    status: "paid",
    ...(hasPaidAtFilter ? { paid_at: subDateFilter } : {}),
  };

  const bookMatch: Record<string, unknown> = {
    teacher_id: { $in: teacherObjectIds },
    status: "active",
    ...(hasBookDateFilter ? { created_at: bookDateFilter } : {}),
  };

  const [subAgg, bookAgg, studentCounts, teachers] = await Promise.all([
    MonthlySubscription.aggregate([
      { $match: subMatch },
      { $group: { _id: "$teacher_id", revenue: { $sum: { $subtract: ["$amount", "$discount"] } }, count: { $sum: 1 } } },
    ]),
    BookSale.aggregate([
      { $match: bookMatch },
      { $group: { _id: "$teacher_id", revenue: { $sum: "$final_price" }, count: { $sum: 1 } } },
    ]),
    Student.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds } } },
      { $group: { _id: "$teacher_id", count: { $sum: 1 } } },
    ]),
    Teacher.find({ center_id: centerId, deleted_at: null }).select("_id name subject is_active").lean(),
  ]);

  const subMap = new Map(subAgg.map((x: any) => [x._id.toString(), x]));
  const bookMap = new Map(bookAgg.map((x: any) => [x._id.toString(), x]));
  const studentMap = new Map(studentCounts.map((x: any) => [x._id.toString(), x.count]));

  // When filtering by a single teacher, only return that teacher's row
  const teacherList = scopedTeacherIds.length === teacherIds.length
    ? (teachers as any[])
    : (teachers as any[]).filter((t: any) => scopedTeacherIds.includes(t._id.toString()));

  const result = teacherList.map((t: any) => {
    const tid = t._id.toString();
    const sub = subMap.get(tid) || { revenue: 0, count: 0 };
    const book = bookMap.get(tid) || { revenue: 0, count: 0 };
    return {
      id: tid,
      name: t.name,
      subject: t.subject || null,
      is_active: t.is_active,
      students_count: studentMap.get(tid) || 0,
      subscriptions_revenue: sub.revenue,
      book_sales_revenue: book.revenue,
      total_revenue: sub.revenue + book.revenue,
      transactions_count: sub.count + book.count,
    };
  }).sort((a: any, b: any) => b.total_revenue - a.total_revenue);

  const totals = result.reduce((acc: any, t: any) => ({
    revenue: acc.revenue + t.total_revenue,
    subscriptions: acc.subscriptions + t.subscriptions_revenue,
    book_sales: acc.book_sales + t.book_sales_revenue,
    transactions: acc.transactions + t.transactions_count,
  }), { revenue: 0, subscriptions: 0, book_sales: 0, transactions: 0 });

  res.json({ teachers: result, totals });
};

// ── Center: own dashboard stats ───────────────────────────────────────────────

export const updateCenterInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;

  // Allowlist only safe fields
  const ALLOWED = ["name", "manager_name", "phone", "whatsapp", "address", "governorate"] as const;
  const updates: Record<string, unknown> = {};

  const egyptianPhoneRegex = /^(\+?20|0)?1[0125]\d{8}$/;

  if (req.body.name !== undefined) {
    const v = (req.body.name || "").trim();
    if (!v || v.length < 2) { res.status(400).json({ message: "اسم السنتر يجب أن يكون حرفين على الأقل" }); return; }
    if (v.length > 100) { res.status(400).json({ message: "اسم السنتر طويل جداً" }); return; }
    updates.name = v;
  }
  if (req.body.manager_name !== undefined) {
    const v = (req.body.manager_name || "").trim();
    if (v && v.length < 2) { res.status(400).json({ message: "اسم المدير يجب أن يكون حرفين على الأقل" }); return; }
    if (v.length > 100) { res.status(400).json({ message: "اسم المدير طويل جداً" }); return; }
    updates.manager_name = v || undefined;
  }
  if (req.body.phone !== undefined) {
    const v = (req.body.phone || "").trim().replace(/[\s\-]/g, "");
    if (v && !egyptianPhoneRegex.test(v)) { res.status(400).json({ message: "رقم الهاتف يجب أن يكون رقماً مصرياً صحيحاً" }); return; }
    updates.phone = v || undefined;
  }
  if (req.body.whatsapp !== undefined) {
    const v = (req.body.whatsapp || "").trim().replace(/[\s\-]/g, "");
    if (v && !egyptianPhoneRegex.test(v)) { res.status(400).json({ message: "رقم واتساب يجب أن يكون رقماً مصرياً صحيحاً" }); return; }
    if (v) {
      // Normalize to 01xxxxxxxxx
      const normalized = v.replace(/^(\+?20)/, "0");
      updates.whatsapp = normalized;
    } else {
      updates.whatsapp = undefined;
    }
  }
  if (req.body.address !== undefined) {
    updates.address = (req.body.address || "").trim() || undefined;
  }
  if (req.body.governorate !== undefined) {
    updates.governorate = (req.body.governorate || "").trim() || undefined;
  }

  const center = await Center.findOneAndUpdate(
    { _id: centerId, deleted_at: null },
    updates,
    { new: true, runValidators: true }
  );
  if (!center) { res.status(404).json({ message: "السنتر غير موجود" }); return; }
  res.json({ ...(center as any).toJSON(), id: (center._id as any).toString() });
};

export const getCenterDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const teacherIds = req.user!.center_teacher_ids || [];

  const { Student } = await import("../models/Student");
  const { MonthlySubscription } = await import("../models/MonthlySubscription");
  const { BookSale } = await import("../models/BookSale");
  const mongoose = await import("mongoose");

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;

  const centerObjId = new mongoose.default.Types.ObjectId(centerId);
  const teacherObjectIds = teacherIds.map((id: string) => new mongoose.default.Types.ObjectId(id));

  // Single Promise.all — no waterfall
  const [
    center,
    activeTeachersCount,
    assistantsCount,
    assistantsActiveCount,
    teachers,
    curSubAgg,
    prevSubAgg,
    curBookAgg,
    prevBookAgg,
    studentCounts,
    teacherSubAgg,
    teacherBookAgg,
    staffPerTeacher,
  ] = await Promise.all([
    Center.findById(centerId).select("_id name email phone address manager_name whatsapp governorate is_active created_at").lean(),
    Teacher.countDocuments({ center_id: centerId, deleted_at: null, is_active: true }),
    CenterStaff.countDocuments({ center_id: centerId, teacher_id: { $ne: null }, deleted_at: null }),
    CenterStaff.countDocuments({ center_id: centerId, teacher_id: { $ne: null }, deleted_at: null, is_active: true }),
    Teacher.find({ center_id: centerId, deleted_at: null }).select("_id name subject is_active").lean(),
    // Total revenue aggregations
    teacherObjectIds.length ? MonthlySubscription.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds }, status: "paid", month: curMonth, year: curYear } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$amount", "$discount"] } } } },
    ]) : Promise.resolve([]),
    teacherObjectIds.length ? MonthlySubscription.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds }, status: "paid", month: prevMonth, year: prevYear } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$amount", "$discount"] } } } },
    ]) : Promise.resolve([]),
    teacherObjectIds.length ? BookSale.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds }, status: "active", month: curMonth, year: curYear } },
      { $group: { _id: null, total: { $sum: "$final_price" } } },
    ]) : Promise.resolve([]),
    teacherObjectIds.length ? BookSale.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds }, status: "active", month: prevMonth, year: prevYear } },
      { $group: { _id: null, total: { $sum: "$final_price" } } },
    ]) : Promise.resolve([]),
    // Per-teacher student counts
    teacherObjectIds.length ? Student.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds } } },
      { $group: { _id: "$teacher_id", count: { $sum: 1 } } },
    ]) : Promise.resolve([]),
    // Per-teacher revenue (current month)
    teacherObjectIds.length ? MonthlySubscription.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds }, status: "paid", month: curMonth, year: curYear } },
      { $group: { _id: "$teacher_id", revenue: { $sum: { $subtract: ["$amount", "$discount"] } } } },
    ]) : Promise.resolve([]),
    teacherObjectIds.length ? BookSale.aggregate([
      { $match: { teacher_id: { $in: teacherObjectIds }, status: "active", month: curMonth, year: curYear } },
      { $group: { _id: "$teacher_id", revenue: { $sum: "$final_price" } } },
    ]) : Promise.resolve([]),
    // Staff per teacher
    CenterStaff.aggregate([
      { $match: { center_id: centerObjId, teacher_id: { $ne: null }, deleted_at: null } },
      { $group: { _id: "$teacher_id", count: { $sum: 1 } } },
    ]),
  ]);

  const curRevenue = ((curSubAgg as any[])[0]?.total || 0) + ((curBookAgg as any[])[0]?.total || 0);
  const prevRevenue = ((prevSubAgg as any[])[0]?.total || 0) + ((prevBookAgg as any[])[0]?.total || 0);
  const revenueGrowth = prevRevenue > 0 ? Math.round(((curRevenue - prevRevenue) / prevRevenue) * 1000) / 10 : null;

  const tSubMap = new Map((teacherSubAgg as any[]).map((x: any) => [x._id.toString(), x.revenue]));
  const tBookMap = new Map((teacherBookAgg as any[]).map((x: any) => [x._id.toString(), x.revenue]));
  const studentMap = new Map((studentCounts as any[]).map((x: any) => [x._id.toString(), x.count]));
  const staffMap = new Map((staffPerTeacher as any[]).map((x: any) => [x._id.toString(), x.count]));

  const teacherRows = (teachers as any[]).map((t: any) => {
    const tid = t._id.toString();
    return {
      id: tid,
      name: t.name,
      subject: t.subject || null,
      is_active: t.is_active,
      assistants_count: staffMap.get(tid) || 0,
      students_count: studentMap.get(tid) || 0,
      current_month_revenue: (tSubMap.get(tid) || 0) + (tBookMap.get(tid) || 0),
    };
  }).sort((a: any, b: any) => b.current_month_revenue - a.current_month_revenue);

  res.json({
    center,
    teachers_count: teacherIds.length,
    active_teachers_count: activeTeachersCount,
    assistants_count: assistantsCount,
    active_assistants_count: assistantsActiveCount,
    current_month_revenue: curRevenue,
    previous_month_revenue: prevRevenue,
    revenue_growth: revenueGrowth,
    current_month: curMonth,
    current_year: curYear,
    teachers: teacherRows,
  });
};
