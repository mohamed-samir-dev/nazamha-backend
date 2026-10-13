import { Response } from "express";
import { BillTemplate } from "../models/BillTemplate";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { validateMoneyAmount } from "../utils/financialValidation";

// BillTemplates are scoped to a single teacher (no multi-teacher views).
// We derive the owning teacher_id from context rather than from req.body.
function resolveTeacherId(req: AuthRequest): string {
  // admins/center users should pass teacher_id in the query or body
  if (req.user!.is_admin || req.user!.user_type === "center" || req.user!.user_type === "staff") {
    return (req.query.teacher_id as string) || (req.body.teacher_id as string) || req.user!.id;
  }
  return req.user!.id;
}

export const getBillTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const templates = await BillTemplate.find(filter).sort({ created_at: -1 });
  res.json(templates);
};

export const addBillTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = resolveTeacherId(req);

  // Validate non-admin scope access
  if (req.user!.is_admin && !req.user!.is_super_admin) {
    if (!req.user!.allowed_teacher_ids?.includes(teacherId)) {
      res.status(403).json({ message: "ليس لديك صلاحية لإضافة قالب لهذا المدرس" });
      return;
    }
  }
  if ((req.user!.user_type === "center" || req.user!.user_type === "staff") &&
      !req.user!.center_teacher_ids?.includes(teacherId)) {
    res.status(403).json({ message: "ليس لديك صلاحية لإضافة قالب لهذا المدرس" });
    return;
  }

  const { title, amount, category, is_active, end_month, end_year } = req.body;

  if (!title || amount == null || !category) {
    res.status(400).json({ message: "العنوان والمبلغ والفئة مطلوبة" });
    return;
  }
  const amountErr = validateMoneyAmount(amount);
  if (amountErr) { res.status(400).json({ message: amountErr }); return; }

  const template = await BillTemplate.create({
    teacher_id: teacherId,
    title: String(title).trim(),
    amount: Number(amount),
    category,
    is_active: is_active !== false,
    end_month: end_month ? Number(end_month) : null,
    end_year: end_year ? Number(end_year) : null,
  });
  res.status(201).json(template);
};

export const updateBillTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = { _id: req.params.id, ...teacherFilter(req) };

  // Whitelist: only safe fields. Never allow teacher_id, _id, or created_at.
  const { title, amount, category, is_active, end_month, end_year } = req.body;
  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates.title = String(title).trim();
  if (category !== undefined) updates.category = category;
  if (is_active !== undefined) updates.is_active = Boolean(is_active);
  if (end_month !== undefined) updates.end_month = end_month ? Number(end_month) : null;
  if (end_year !== undefined) updates.end_year = end_year ? Number(end_year) : null;

  if (amount !== undefined) {
    const amountErr = validateMoneyAmount(amount);
    if (amountErr) { res.status(400).json({ message: amountErr }); return; }
    updates.amount = Number(amount);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "لا توجد حقول للتحديث" });
    return;
  }

  const template = await BillTemplate.findOneAndUpdate(
    filter,
    { $set: updates },  // explicit $set — prevents operator injection
    { new: true, runValidators: true }
  );
  if (!template) { res.status(404).json({ message: "القالب غير موجود" }); return; }
  res.json(template);
};

export const deleteBillTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  await BillTemplate.findOneAndDelete({ _id: req.params.id, ...teacherFilter(req) });
  res.json({ message: "تم الحذف بنجاح" });
};
