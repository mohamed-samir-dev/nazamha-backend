// cspell:disable
import crypto from "crypto";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Teacher } from "../models/Teacher";
import { Admin } from "../models/Admin";
import { AuthRequest, UserType } from "../middleware/auth";
import { revokeToken } from "../services/tokenBlacklist";

const signToken = (id: string, user_type: UserType, extra: Record<string, unknown> = {}): string => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || "7d") as `${number}${'s'|'m'|'h'|'d'|'w'|'y'}` | number;
  return jwt.sign({ id, user_type, ...extra }, process.env.JWT_SECRET!, { expiresIn });
};



const IS_PROD = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: (IS_PROD ? "none" : "strict") as "none" | "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const MAX_FAILED_ATTEMPTS = 5;

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const teacher = await Teacher.findOne({ email }).select("+password");

  if (!teacher) {
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  if (teacher.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
    res.status(403).json({ message: "تم تجاوز الحد الأقصى لمحاولات الدخول. تواصل مع مدير النظام." });
    return;
  }

  // فحص الحساب قبل مقارنة الباسورد — لا نكشف أن الباسورد صحيحة لحساب معطل
  if (!teacher.is_active) {
    res.status(403).json({ message: "الحساب غير مفعّل. تواصل مع مدير النظام." });
    return;
  }

  if (!(await teacher.comparePassword(password))) {
    teacher.failed_login_attempts += 1;
    await teacher.save({ validateBeforeSave: false });
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  teacher.last_login_at = new Date();
  teacher.last_login_ip = req.ip;
  teacher.failed_login_attempts = 0;
  await teacher.save({ validateBeforeSave: false });

  const token = signToken(teacher._id.toString(), "teacher", { version: teacher.session_version || 0 });
  res.cookie("token", token, COOKIE_OPTIONS);
  res.json({ token, teacher: { id: teacher._id, name: teacher.name, email: teacher.email, slug: teacher.slug, is_admin: false } });
};

// Brute Force Protection: blocks account after MAX_FAILED_ATTEMPTS failed attempts
export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email }).select("+password");
  if (!admin) {
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  if (admin.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
    res.status(403).json({ message: "تم تجاوز الحد الأقصى لمحاولات الدخول. تواصل مع مدير النظام." });
    return;
  }

  // فحص الحساب قبل مقارنة الباسورد — لا نكشف أن الباسورد صحيحة لحساب معطل
  if (!admin.is_active) {
    res.status(403).json({ message: "الحساب معطل. تواصل مع مدير النظام." });
    return;
  }

  if (!(await admin.comparePassword(password))) {
    admin.failed_login_attempts += 1;
    await admin.save({ validateBeforeSave: false });
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  admin.last_login_at = new Date();
  admin.last_login_ip = req.ip;
  admin.failed_login_attempts = 0;
  await admin.save({ validateBeforeSave: false });

  // Audit successful admin login
  import("../models/AuditLog").then(({ AuditLog }) => {
    AuditLog.create({
      admin_id: admin._id.toString(),
      admin_name: admin.name,
      action: "admin.login" as any,
      resource_type: "Auth",
      ip_address: req.ip,
    }).catch(() => {});
  });

  const token = signToken(admin._id.toString(), "admin", { is_admin: true, is_super_admin: admin.is_super_admin, version: admin.session_version || 0 });
  res.cookie("token", token, COOKIE_OPTIONS);
  res.json({ token, admin: { id: admin._id, name: admin.name, email: admin.email, is_admin: true, is_super_admin: admin.is_super_admin } });
};

export const centerLogin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const { Center } = await import("../models/Center");
  const center = await Center.findOne({ email, deleted_at: null }).select("+password");

  if (!center) {
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  if (center.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
    res.status(403).json({ message: "تم تجاوز الحد الأقصى لمحاولات الدخول. تواصل مع مدير النظام." });
    return;
  }

  // فحص الحساب قبل مقارنة الباسورد — لا نكشف أن الباسورد صحيحة لحساب معطل
  if (!center.is_active) {
    res.status(403).json({ message: "الحساب معطل. تواصل مع مدير النظام." });
    return;
  }

  if (!(await center.comparePassword(password))) {
    center.failed_login_attempts += 1;
    await center.save({ validateBeforeSave: false });
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  center.last_login_at = new Date();
  center.last_login_ip = req.ip;
  center.failed_login_attempts = 0;
  await center.save({ validateBeforeSave: false });

  const token = signToken(center._id.toString(), "center", { version: center.session_version || 0 });
  res.cookie("token", token, COOKIE_OPTIONS);
  res.json({ token, center: { id: center._id, name: center.name, email: center.email, user_type: "center" } });
};

export const staffLogin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const { CenterStaff } = await import("../models/CenterStaff");
  const staff = await CenterStaff.findOne({ email, deleted_at: null }).select("+password");

  if (!staff) {
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  if (staff.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
    res.status(403).json({ message: "تم تجاوز الحد الأقصى لمحاولات الدخول. تواصل مع مدير السنتر." });
    return;
  }

  // فحص الحساب قبل مقارنة الباسورد — لا نكشف أن الباسورد صحيحة لحساب معطل
  if (!staff.is_active) {
    res.status(403).json({ message: "الحساب معطل. تواصل مع مدير السنتر." });
    return;
  }

  if (!(await staff.comparePassword(password))) {
    staff.failed_login_attempts += 1;
    await staff.save({ validateBeforeSave: false });
    res.status(401).json({ message: "البريد أو كلمة المرور غير صحيحة" });
    return;
  }

  staff.last_login_at = new Date();
  staff.last_login_ip = req.ip;
  staff.failed_login_attempts = 0;
  await staff.save({ validateBeforeSave: false });

  const token = signToken(staff._id.toString(), "staff", { version: staff.session_version || 0 });
  res.cookie("token", token, COOKIE_OPTIONS);
  res.json({
    token,
    staff: {
      id: staff._id,
      name: staff.name,
      email: staff.email,
      center_id: staff.center_id,
      teacher_id: (staff as any).teacher_id ?? null,
      permissions: staff.permissions,
      user_type: "staff",
    },
  });
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  // Extract the raw token so we can blacklist it (C2 fix — token invalidated on logout)
  const rawToken =
    req.cookies?.token ||
    (req.headers.authorization?.replace("Bearer ", "") ?? "");

  if (rawToken) {
    try {
      const decoded = jwt.decode(rawToken) as { exp?: number } | null;
      const ttlSecs = decoded?.exp
        ? decoded.exp - Math.floor(Date.now() / 1000)
        : 0;
      await revokeToken(rawToken, ttlSecs);
    } catch {
      // If blacklisting fails, still proceed with logout — cookie is cleared below
    }

    // Also flush the in-memory cache for this user so the 15-min window doesn't
    // keep the token alive inside this process
    const { invalidateTokenCache } = await import("../middleware/auth");
    invalidateTokenCache(req.user!.id);
  }

  res.clearCookie("token", { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? "none" : "strict" });
  res.json({ message: "تم تسجيل الخروج" });
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const user_type = req.user!.actor_type || req.user!.user_type;

  if (user_type === "admin") {
    const admin = await Admin.findById(req.user!.id).select("-password").lean();
    if (!admin) { res.status(404).json({ message: "المستخدم غير موجود" }); return; }
    const a = admin as any;
    res.set("Cache-Control", "no-store");
    res.json({
      ...a,
      id: a._id.toString(),
      user_type: "admin",
      is_admin: true,
      is_super_admin: a.is_super_admin,
      financial_permissions: a.financial_permissions,
      allowed_teacher_ids: a.is_super_admin ? null : [],
    });
    return;
  }

  if (user_type === "center") {
    const { Center } = await import("../models/Center");
    const center = await Center.findById(req.user!.id).lean();
    if (!center) { res.status(404).json({ message: "المستخدم غير موجود" }); return; }
    res.json({ ...(center as any), id: (center as any)._id?.toString(), user_type: "center" });
    return;
  }

  if (user_type === "staff") {
    const { CenterStaff } = await import("../models/CenterStaff");
    const staff = await CenterStaff.findById(req.user!.actor_id || req.user!.id).lean();
    if (!staff) { res.status(404).json({ message: "المستخدم غير موجود" }); return; }
    const s = staff as any;
    const effectiveTeacherId = s.teacher_id?.toString() ?? null;
    // If assistant (has teacher_id): return teacher's data so frontend works identically
    if (effectiveTeacherId) {
      const teacher = await Teacher.findById(effectiveTeacherId).lean();
      if (teacher) {
        const t = teacher as any;
        res.json({
          ...t,
          id: t._id?.toString(),
          user_type: "teacher",
          is_admin: false,
          is_center_mode: t.is_center_mode ?? false,
          has_bills_feature: t.has_bills_feature ?? t.features?.bills ?? false,
          has_attendance_feature: t.has_attendance_feature ?? t.features?.attendance ?? true,
          has_centers_feature: t.features?.centers ?? false,
          subscription_started_at: t.subscription_started_at ?? t.subscription?.started_at ?? null,
          subscription_expires_at: t.subscription_expires_at ?? t.subscription?.expires_at ?? null,
          teacher_id: effectiveTeacherId,
          effective_teacher_id: effectiveTeacherId,
        });
        return;
      }
    }
    res.json({
      ...s,
      id: s._id?.toString(),
      user_type: "staff",
      teacher_id: effectiveTeacherId,
      effective_teacher_id: effectiveTeacherId,
    });
    return;
  }

  // teacher
  const teacher = await Teacher.findById(req.user!.id).lean();
  if (!teacher) { res.status(404).json({ message: "المستخدم غير موجود" }); return; }
  const t = teacher as any;
  res.json({
    ...t,
    id: t._id?.toString(),
    user_type: "teacher",
    is_admin: false,
    is_center_mode: t.is_center_mode ?? false,
    has_bills_feature: t.has_bills_feature ?? t.features?.bills ?? false,
    has_attendance_feature: t.has_attendance_feature ?? t.features?.attendance ?? true,
    has_centers_feature: t.features?.centers ?? false,
    subscription_started_at: t.subscription_started_at ?? t.subscription?.started_at ?? null,
    subscription_expires_at: t.subscription_expires_at ?? t.subscription?.expires_at ?? null,
    ...(req.user!.effective_teacher_id ? { effective_teacher_id: req.user!.effective_teacher_id } : {}),
  });
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  const user_type = req.user!.actor_type || req.user!.user_type;
  const { invalidateTokenCache } = await import("../middleware/auth");

  if (user_type === "admin") {
    const admin = await Admin.findById(req.user!.id).select("+password");
    if (!admin || !(await admin.comparePassword(currentPassword))) {
      res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" }); return;
    }
    admin.password = newPassword;
    await admin.save();
    invalidateTokenCache(req.user!.id);
  } else if (user_type === "center") {
    const { Center } = await import("../models/Center");
    const center = await Center.findById(req.user!.id).select("+password");
    if (!center || !(await center.comparePassword(currentPassword))) {
      res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" }); return;
    }
    center.password = newPassword;
    await center.save();
    invalidateTokenCache(req.user!.id);
  } else if (user_type === "staff") {
    const { CenterStaff } = await import("../models/CenterStaff");
    const staff = await CenterStaff.findById(req.user!.actor_id || req.user!.id).select("+password");
    if (!staff || !(await staff.comparePassword(currentPassword))) {
      res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" }); return;
    }
    staff.password = newPassword;
    await staff.save();
    invalidateTokenCache(req.user!.id);
  } else {
    const teacher = await Teacher.findById(req.user!.id).select("+password");
    if (!teacher || !(await teacher.comparePassword(currentPassword))) {
      res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" }); return;
    }
    teacher.password = newPassword;
    await teacher.save();
    invalidateTokenCache(req.user!.id);
  }
  res.json({ message: "تم تغيير كلمة المرور بنجاح" });
};
