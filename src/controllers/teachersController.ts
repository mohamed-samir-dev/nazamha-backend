import { Response } from "express";
import mongoose from "mongoose";
import { Teacher, ITeacher } from "../models/Teacher";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { AuthRequest, canAccessTeacher } from "../middleware/auth";
import { syncNewMonthForAllStudents, syncAllStudentsForTeacher } from "../services/subscriptionLifecycle";
import { AuditLog } from "../models/AuditLog";
import { invalidateTokenCache } from "../middleware/auth";

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacher = await Teacher.findById(req.user!.id);
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
  res.json(teacher);
};

export const changeMyPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: "كلمة المرور الحالية والجديدة مطلوبتان" }); return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ message: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل" }); return;
  }
  const teacher = await Teacher.findById(req.user!.id).select("+password");
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
  const isMatch = await teacher.comparePassword(currentPassword);
  if (!isMatch) { res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" }); return; }
  teacher.password = newPassword;
  await teacher.save();
  invalidateTokenCache(req.user!.id);
  res.json({ message: "تم تغيير كلمة المرور بنجاح" });
};

export const updateMe = async (req: AuthRequest, res: Response): Promise<void> => {
  // Strict whitelist — only these fields may be updated by the teacher themselves.
  // ALL subscription, billing, feature, and status fields are intentionally excluded.
  const ALLOWED_SELF_UPDATE_FIELDS: (keyof ITeacher)[] = [
    "name", "phone", "avatar", "bio", "subject",
    "experience_years", "gender",
    "settings", "social", "payment", "theme", "banner",
    "center", "academic_year",
  ];

  const update: Partial<Record<string, unknown>> = {};
  for (const field of ALLOWED_SELF_UPDATE_FIELDS) {
    if (field in req.body) update[field] = req.body[field as string];
  }

  const newMonths: number[] | undefined = (req.body as any)?.academic_year?.active_months;
  const newMonthYears: { month: number; year: number }[] | undefined = (req.body as any)?.academic_year?.active_month_years;

  const teacher = await Teacher.findByIdAndUpdate(req.user!.id, { $set: update }, { new: true });
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }

  if (newMonths?.length || newMonthYears?.length) {
    syncAllStudentsForTeacher(String(req.user!.id)).catch(console.error);
  }

  res.json(teacher);
};

const SENSITIVE_FIELDS = "-password -email_verification_token -refresh_token -last_login_ip";

export const getAllTeachers = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter: Record<string, unknown> = {};
  if (!req.user!.is_super_admin) { filter.hidden_from_admin = { $ne: true }; filter._id = { $in: req.user!.allowed_teacher_ids || [] }; }

  // Support optional pagination via ?page=&limit= query params.
  // If neither is provided, return all (backward-compatible for legacy callers).
  const pageParam = req.query.page ? Math.max(1, Number(req.query.page)) : null;
  const limitParam = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : null;

  if (pageParam !== null && limitParam !== null) {
    const skip = (pageParam - 1) * limitParam;
    const [teachers, total] = await Promise.all([
      Teacher.find(filter).select(SENSITIVE_FIELDS).sort({ created_at: -1 }).skip(skip).limit(limitParam),
      Teacher.countDocuments(filter),
    ]);
    res.json({ teachers, total, page: pageParam, pages: Math.ceil(total / limitParam) });
    return;
  }

  const teachers = await Teacher.find(filter).select(SENSITIVE_FIELDS).sort({ created_at: -1 });
  res.json(teachers);
};

export const getTeacherCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter: Record<string, unknown> = {};
  if (!req.user!.is_super_admin) { filter.hidden_from_admin = { $ne: true }; filter._id = { $in: req.user!.allowed_teacher_ids || [] }; }

  const teachers = await Teacher.find(filter).select("_id").lean();
  const teacherOids = teachers.map((t: any) => new mongoose.Types.ObjectId(t._id.toString()));

  const [studentCounts, groupCounts] = await Promise.all([
    Student.aggregate([{ $match: { teacher_id: { $in: teacherOids } } }, { $group: { _id: "$teacher_id", count: { $sum: 1 } } }]),
    Group.aggregate([{ $match: { teacher_id: { $in: teacherOids } } }, { $group: { _id: "$teacher_id", count: { $sum: 1 } } }]),
  ]);

  const students: Record<string, number> = {};
  const groups: Record<string, number> = {};
  studentCounts.forEach((r: any) => { students[r._id.toString()] = r.count; });
  groupCounts.forEach((r: any) => { groups[r._id.toString()] = r.count; });

  res.json({ students, groups });
};

export const getAdminStats = async (req: AuthRequest, res: Response): Promise<void> => {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = {};
  if (!req.user!.is_super_admin) { filter.hidden_from_admin = { $ne: true }; filter._id = { $in: req.user!.allowed_teacher_ids || [] }; }

  const [expiringSoon, pendingApproval, recentLogs] = await Promise.all([
    Teacher.countDocuments({
      ...filter,
      is_active: true,
      subscription_expires_at: { $gte: now, $lte: in30Days },
    }),
    Teacher.countDocuments({
      ...filter,
      is_active: false,
      subscription_started_at: { $exists: false },
    }),
    AuditLog.find({ ...(!req.user!.is_super_admin ? { resource_id: { $in: req.user!.allowed_teacher_ids || [] } } : {}), action: { $in: ["teacher.activate", "teacher.deactivate", "teacher.price_update", "teacher.create", "teacher.delete"] } })
      .sort({ created_at: -1 })
      .limit(15)
      .lean(),
  ]);

  res.json({ expiringSoon, pendingApproval, recentLogs });
};

export const createTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, email, password, phone, monthly_price, subscription_price, has_bills_feature, has_attendance_feature, is_center_mode, plan_id, subscription_expires_at } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ message: "الاسم والبريد وكلمة المرور مطلوبة" }); return;
  }
  let teacher;
  try {
  teacher = await Teacher.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    phone: phone?.trim() || undefined,
    monthly_price: Number(monthly_price) || 0,
    subscription_price: Number(subscription_price) || 0,
    has_bills_feature: has_bills_feature ?? false,
    has_attendance_feature: has_attendance_feature ?? true,
    is_center_mode: is_center_mode ?? false,
    is_active: true,
    plan_id: plan_id || null,
    subscription_started_at: new Date(),
    subscription_expires_at: subscription_expires_at ? new Date(subscription_expires_at) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(400).json({ message: "البريد الإلكتروني مستخدم بالفعل" }); return;
    }
    throw err;
  }
  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Super Admin",
    action: "teacher.create",
    resource_type: "Teacher",
    resource_id: (teacher._id as any).toString(),
    new_data: { name, email },
    ip_address: req.ip,
  });
  res.status(201).json(teacher);
};

export const getTeacherById = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!canAccessTeacher(req, req.params.id)) { res.status(403).json({ message: "غير مصرح" }); return; }
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
  if (teacher.hidden_from_admin && !req.user!.is_super_admin) {
    res.status(403).json({ message: "غير مصرح" }); return;
  }
  res.json(teacher);
};

export const toggleTeacherVisibility = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
  teacher.hidden_from_admin = !teacher.hidden_from_admin;
  await teacher.save({ validateBeforeSave: false });
  invalidateTokenCache("all");
  res.json({ hidden_from_admin: teacher.hidden_from_admin });
};

export const updateTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!canAccessTeacher(req, req.params.id)) { res.status(403).json({ message: "غير مصرح" }); return; }
  // Strict whitelist — admins may only update these teacher fields.
  // password, slug, is_super_admin, center_id, refresh_token, email_verification_token etc. are excluded.
  const ALLOWED_ADMIN_UPDATE_FIELDS = new Set([
    "name", "email", "phone", "avatar", "bio", "subject",
    "experience_years", "gender",
    "is_active",
    "subscription_price", "subscription_expires_at", "subscription_started_at",
    "has_bills_feature", "has_attendance_feature", "is_center_mode",
    "features", "settings", "theme", "banner", "center", "social", "payment",
    "monthly_price", "plan_id", "hidden_from_admin", "academic_year",
    "password",
  ]);

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(req.body)) {
    if (ALLOWED_ADMIN_UPDATE_FIELDS.has(key)) {
      update[key] = req.body[key];
    }
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ message: "لا توجد حقول مسموح بتحديثها" });
    return;
  }

  const old = await Teacher.findById(req.params.id).lean();

  let teacher;
  if (update.password) {
    // findByIdAndUpdate bypasses the pre("save") hook so password won't be hashed.
    // We must use .save() to trigger bcrypt hashing.
    const { password, ...rest } = update;
    teacher = await Teacher.findById(req.params.id).select("+password");
    if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
    Object.assign(teacher, rest);
    teacher.password = password as string;
    await teacher.save();
    teacher = await Teacher.findById(req.params.id);
  } else {
    teacher = await Teacher.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  }

  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }

  // Audit: activation change
  if (old && update.is_active !== undefined && (old as any).is_active !== update.is_active) {
    await AuditLog.create({
      admin_id: req.user!.id,
      admin_name: "Admin",
      action: update.is_active ? "teacher.activate" : "teacher.deactivate",
      resource_type: "Teacher",
      resource_id: req.params.id,
      old_data: { is_active: (old as any).is_active },
      new_data: { is_active: update.is_active },
      ip_address: req.ip,
    });
  }

  // Audit: price change
  if (old && update.subscription_price !== undefined && (old as any).subscription_price !== update.subscription_price) {
    await AuditLog.create({
      admin_id: req.user!.id,
      admin_name: "Admin",
      action: "teacher.price_update",
      resource_type: "Teacher",
      resource_id: req.params.id,
      old_data: { subscription_price: (old as any).subscription_price },
      new_data: { subscription_price: update.subscription_price, teacher_name: teacher.name },
      ip_address: req.ip,
    });
  }

  // Invalidate cached token so any permission/status/password updates take effect immediately
  invalidateTokenCache(req.params.id);

  res.json(teacher);
};

export const deleteTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacher = await Teacher.findByIdAndUpdate(req.params.id, { $set: { is_active: false, deleted_at: new Date() } }, { new: true });
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Admin",
    action: "teacher.delete",
    resource_type: "Teacher",
    resource_id: req.params.id,
    new_data: { name: teacher.name, email: teacher.email },
    ip_address: req.ip,
  });
  res.json({ message: "تم الحذف بنجاح" });
};

export const updateTeacherBanner = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!canAccessTeacher(req, req.params.id)) { res.status(403).json({ message: "غير مصرح" }); return; }
  const { enabled, message, type } = req.body;
  const teacher = await Teacher.findByIdAndUpdate(
    req.params.id,
    { banner: { enabled: !!enabled, message: message || "", type: type || "info" } },
    { new: true, runValidators: true }
  );
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }
  res.json(teacher.banner);
};
