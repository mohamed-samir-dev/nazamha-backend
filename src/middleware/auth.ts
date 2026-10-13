import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Teacher } from "../models/Teacher";
import { Admin, FinancialPermission } from "../models/Admin";
import { Center } from "../models/Center";
import { CenterStaff, StaffPermission } from "../models/CenterStaff";
import { AdminTeacherAccess } from "../models/AdminTeacherAccess";
import { isTokenRevoked } from "../services/tokenBlacklist";
import { enforceResourcePermissions } from "./resourcePermissions";
export type UserType = "teacher" | "admin" | "center" | "staff";
export interface AuthRequest extends Request {
  user?: { id: string; actor_id?: string; actor_type?: UserType; user_type: UserType;
    is_admin: boolean; is_super_admin: boolean; financial_permissions: FinancialPermission[];
    allowed_teacher_ids?: string[]; center_id?: string; center_teacher_ids?: string[];
    staff_permissions?: StaffPermission[]; effective_teacher_id?: string; };
}
// Authorization state is deliberately read fresh. A cached role must never outlive
// suspension, reassignment or a password reset on another server process.
export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies?.token || req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) { res.status(401).json({ message: "غير مصرح" }); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    if (typeof decoded.id !== "string" || !decoded.iat || await isTokenRevoked(token)) {
      res.status(401).json({ message: "تم إلغاء الجلسة" }); return;
    }
    const type: UserType = decoded.user_type ?? (decoded.is_admin ? "admin" : "teacher");
    const models = { teacher: Teacher, admin: Admin, center: Center, staff: CenterStaff };
    if (!Object.prototype.hasOwnProperty.call(models, type)) { res.sendStatus(401); return; }
    const account: any = await (models[type] as any).findById(decoded.id).lean();
    if (!account || account.deleted_at || !account.is_active) { res.status(403).json({ message: "الحساب غير متاح" }); return; }
    if ((decoded.version ?? 0) !== (account.session_version || 0)) { res.status(401).json({ message: "تم إلغاء الجلسة" }); return; }
    if (account.password_changed_at && decoded.iat < Math.floor(new Date(account.password_changed_at).getTime() / 1000)) {
      res.status(401).json({ message: "تم تغيير كلمة المرور، سجل الدخول مجدداً" }); return;
    }
    const id = String(account._id);
    req.user = { id, actor_id: id, actor_type: type, user_type: type, is_admin: type === "admin",
      is_super_admin: type === "admin" && !!account.is_super_admin, financial_permissions: account.financial_permissions || [] };
    if (type === "admin" && !account.is_super_admin) {
      const access = await AdminTeacherAccess.find({ admin_id: id }).lean();
      const teachers = await Teacher.find({ _id: { $in: access.map(a => a.teacher_id) }, hidden_from_admin: { $ne: true }, deleted_at: null }).select("_id").lean();
      req.user.allowed_teacher_ids = teachers.map(t => String(t._id));
    }
    if (type === "center" || type === "staff" || (type === "teacher" && account.center_id)) {
      const centerId = type === "center" ? id : String(account.center_id);
      const center = type === "center" ? account : await Center.findOne({ _id: centerId, is_active: true, deleted_at: null }).lean();
      if (!center) { res.status(403).json({ message: "السنتر غير متاح" }); return; }
      req.user.center_id = centerId;
      if (type === "center" || type === "staff") {
        const filter: Record<string, unknown> = { center_id: centerId, deleted_at: null, is_active: true };
        if (type === "staff" && account.teacher_id) filter._id = account.teacher_id;
        const teachers = await Teacher.find(filter).select("_id").lean();
        req.user.center_teacher_ids = teachers.map(t => String(t._id));
        if (type === "staff") {
          req.user.staff_permissions = account.permissions || [];
          if (account.teacher_id) {
            const tid = String(account.teacher_id);
            if (!req.user.center_teacher_ids.includes(tid)) { res.status(403).json({ message: "المدرس غير متاح" }); return; }
            // Keep the effective owner for legacy controllers, but preserve the actor
            // and enforce their delegated permissions independently of this view.
            req.user.id = tid; req.user.user_type = "teacher";
            req.user.effective_teacher_id = tid; req.user.allowed_teacher_ids = [tid];
          }
        }
      }
    }
    if (type === "teacher") req.user.allowed_teacher_ids = [id];
    enforceResourcePermissions(req, res, next);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: "توكن غير صالح أو منتهي الصلاحية" });
    } else { next(error); }
  }
};
// ── Role guards ───────────────────────────────────────────────────────────────

export const adminOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user?.is_admin) {
    res.status(403).json({ message: "مسموح للأدمن فقط" });
    return;
  }
  next();
};

export const superAdminOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user?.is_super_admin) {
    res.status(403).json({ message: "مسموح للمدير العام فقط" });
    return;
  }
  next();
};

export const centerOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.user_type !== "center") {
    res.status(403).json({ message: "مسموح لصاحب السنتر فقط" });
    return;
  }
  next();
};

export const centerOrStaff = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.user_type !== "center" && req.user?.user_type !== "staff") {
    res.status(403).json({ message: "غير مصرح" });
    return;
  }
  next();
};

export const requireStaffPermission = (permission: StaffPermission) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.user?.user_type === "center") return next(); // owner has all permissions
    if (req.user?.user_type !== "staff") {
      res.status(403).json({ message: "غير مصرح" });
      return;
    }
    if (!req.user.staff_permissions?.includes(permission)) {
      res.status(403).json({ message: `ليس لديك صلاحية: ${permission}` });
      return;
    }
    next();
  };
};

export const requirePermission = (permission: FinancialPermission) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user?.is_admin) {
      res.status(403).json({ message: "غير مصرح" });
      return;
    }
    if (req.user.is_super_admin) return next();
    if (!req.user.financial_permissions.includes(permission)) {
      res.status(403).json({ message: "ليس لديك صلاحية للوصول لهذه البيانات المالية" });
      return;
    }
    next();
  };
};

export const requireCenterPermission = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user?.is_admin) {
    res.status(403).json({ message: "غير مصرح" });
    return;
  }
  if (req.user.is_super_admin) return next();
  if (!req.user.financial_permissions.includes("centers.view" as FinancialPermission)) {
    res.status(403).json({ message: "ليس لديك صلاحية للوصول إلى السناتر" });
    return;
  }
  next();
};

// ── Teacher filter helpers ────────────────────────────────────────────────────

/**
 * Returns MongoDB filter for teacher_id based on current user type.
 * Used in all controllers that filter by teacher ownership.
 */
export function teacherFilter(req: AuthRequest): Record<string, unknown> {
  const u = req.user!;
  if (u.user_type === "center" || u.user_type === "staff") {
    return { teacher_id: { $in: u.center_teacher_ids || [] } };
  }
  if (u.user_type === "teacher") return { teacher_id: u.id };
  if (u.is_super_admin) return {};
  return { teacher_id: { $in: u.allowed_teacher_ids || [] } };
}

export function getAdminTeacherFilter(req: AuthRequest): { teacher_id: { $in: string[] } } | Record<string, never> {
  if (!req.user?.is_admin) {
    return { teacher_id: { $in: req.user?.center_teacher_ids && req.user.user_type !== "teacher" ? req.user.center_teacher_ids : [req.user!.id] } };
  }
  if (req.user.is_super_admin) return {};
  return { teacher_id: { $in: req.user.allowed_teacher_ids || [] } };
}

export async function getVisibleTeacherIds(req: AuthRequest): Promise<string[] | null> {
  if (!req.user?.is_admin) return [req.user!.id];
  if (req.user.is_super_admin) return null;
  const { Teacher } = await import("../models/Teacher");
  const allowed = req.user.allowed_teacher_ids || [];
  const visible = await (Teacher as any).find(
    { _id: { $in: allowed }, hidden_from_admin: { $ne: true } },
    { _id: 1 }
  ).lean();
  return visible.map((t: any) => t._id.toString());
}

// Compatibility for callers; there is no stale authorization cache to invalidate.
export function invalidateTokenCache(_id: string): void {}
export function canAccessTeacher(req: AuthRequest, id: unknown): boolean {
  if (typeof id !== "string") return false;
  const u = req.user!;
  if (u.is_super_admin) return true;
  if (u.user_type === "teacher") return u.id === id;
  if (u.user_type === "center" || u.user_type === "staff") return !!u.center_teacher_ids?.includes(id);
  return !!u.allowed_teacher_ids?.includes(id);
}
