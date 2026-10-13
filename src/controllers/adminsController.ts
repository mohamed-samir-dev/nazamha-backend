import { Response } from "express";
import { Admin, ALL_FINANCIAL_PERMISSIONS } from "../models/Admin";
import { AdminTeacherAccess } from "../models/AdminTeacherAccess";
import { AuditLog } from "../models/AuditLog";
import { AuthRequest, invalidateTokenCache } from "../middleware/auth";

async function getCurrentAdminName(req: AuthRequest): Promise<string> {
  try {
    const admin = await Admin.findById(req.user!.id).select("name").lean();
    return (admin as any)?.name || "Admin";
  } catch {
    return "Admin";
  }
}

// ─── List all admins (super admin only) ───────────────────────────────────────
export const getAdmins = async (req: AuthRequest, res: Response): Promise<void> => {
  const admins = await Admin.find({ deleted_at: null, is_super_admin: false })
    .select("-password")
    .sort({ created_at: -1 })
    .lean();

  const adminIds = admins.map((a: any) => a._id);
  const accesses = await AdminTeacherAccess.find({ admin_id: { $in: adminIds } }).lean();

  const countMap: Record<string, number> = {};
  for (const a of accesses) {
    const key = a.admin_id.toString();
    countMap[key] = (countMap[key] || 0) + 1;
  }

  const result = admins.map((a: any) => ({
    ...a,
    id: a._id.toString(),
    teachers_count: countMap[a._id.toString()] || 0,
  }));

  res.json(result);
};

// ─── Get single admin with their teacher access ───────────────────────────────
export const getAdminById = async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await Admin.findOne({ _id: req.params.id, deleted_at: null }).select("-password").lean();
  if (!admin) { res.status(404).json({ message: "الأدمن غير موجود" }); return; }

  const accesses = await AdminTeacherAccess.find({ admin_id: admin._id }).select("teacher_id").lean();
  res.json({
    ...admin,
    id: (admin._id as any).toString(),
    allowed_teacher_ids: accesses.map((a: any) => a.teacher_id.toString()),
  });
};

// ─── Create admin ─────────────────────────────────────────────────────────────
export const createAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, email, password, teacher_ids = [], financial_permissions = [] } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ message: "الاسم والبريد وكلمة المرور مطلوبة" });
    return;
  }

  const existing = await Admin.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(400).json({ message: "البريد الإلكتروني مستخدم بالفعل" });
    return;
  }

  const validPerms = financial_permissions.filter((p: string) =>
    ALL_FINANCIAL_PERMISSIONS.includes(p as any)
  );

  const admin = await Admin.create({ name, email, password, financial_permissions: validPerms });

  if (teacher_ids.length > 0) {
    await AdminTeacherAccess.insertMany(
      teacher_ids.map((tid: string) => ({ admin_id: admin._id, teacher_id: tid })),
      { ordered: false }
    );
  }

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: await getCurrentAdminName(req),
    action: "admin.create",
    resource_type: "Admin",
    resource_id: (admin._id as any).toString(),
    new_data: { name, email },
    ip_address: req.ip,
  });

  const { password: _password, ...safeAdmin } = admin.toObject();
  res.status(201).json({ ...safeAdmin, id: (admin._id as any).toString() });
};

// ─── Update admin ─────────────────────────────────────────────────────────────
export const updateAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  const { teacher_ids, financial_permissions, name, email, password, is_active } = req.body;

  const admin = await Admin.findOne({ _id: req.params.id, deleted_at: null, is_super_admin: false });
  if (!admin) { res.status(404).json({ message: "الأدمن غير موجود" }); return; }

  const oldData: Record<string, unknown> = { name: admin.name, email: admin.email, is_active: admin.is_active };

  if (name) admin.name = name;
  if (email) admin.email = email;
  if (password) admin.password = password;
  if (typeof is_active === "boolean") admin.is_active = is_active;
  if (Array.isArray(financial_permissions)) {
    admin.financial_permissions = financial_permissions.filter((p: string) =>
      ALL_FINANCIAL_PERMISSIONS.includes(p as any)
    ) as any;
  }

  await admin.save({ validateModifiedOnly: true });

  // Update teacher access
  if (Array.isArray(teacher_ids)) {
    await AdminTeacherAccess.deleteMany({ admin_id: admin._id });
    if (teacher_ids.length > 0) {
      await AdminTeacherAccess.insertMany(
        teacher_ids.map((tid: string) => ({ admin_id: admin._id, teacher_id: tid })),
        { ordered: false }
      );
    }
  }

  // Invalidate token cache so new permissions take effect immediately
  invalidateTokenCache((admin._id as any).toString());

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: await getCurrentAdminName(req),
    action: "admin.update",
    resource_type: "Admin",
    resource_id: (admin._id as any).toString(),
    old_data: oldData,
    new_data: { name, email, is_active, financial_permissions },
    ip_address: req.ip,
  });

  res.json({ message: "تم التحديث بنجاح" });
};

// ─── Deactivate admin (soft delete) ──────────────────────────────────────────
export const deactivateAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await Admin.findOne({ _id: req.params.id, deleted_at: null, is_super_admin: false });
  if (!admin) { res.status(404).json({ message: "الأدمن غير موجود" }); return; }

  admin.is_active = false;
  admin.deleted_at = new Date();
  await admin.save({ validateModifiedOnly: true });

  invalidateTokenCache((admin._id as any).toString());

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: await getCurrentAdminName(req),
    action: "admin.deactivate",
    resource_type: "Admin",
    resource_id: (admin._id as any).toString(),
    ip_address: req.ip,
  });

  res.json({ message: "تم تعطيل الأدمن بنجاح" });
};

// ─── Get audit logs ───────────────────────────────────────────────────────────
export const getAuditLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (req.query.admin_id) filter.admin_id = req.query.admin_id;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
};
