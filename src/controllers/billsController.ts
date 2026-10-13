import { Response } from "express";
import { Bill } from "../models/Bill";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import {
  validateMoneyAmount,
  validatePositiveAmount,
  validateBillingPeriod,
  validateMonth,
  validateYear,
} from "../utils/financialValidation";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the teacher_id from the authenticated user.
 * Teachers always get their own id.
 * Admins/center/staff can pass a teacher_id in the body (checked against scope).
 */
function resolveTeacherId(req: AuthRequest): string {
  if (req.user!.user_type === "teacher") return req.user!.id;
  return (req.body.teacher_id as string) || req.user!.id;
}

/**
 * Verify that the resolved teacher_id is within the caller's permitted scope.
 * Returns an error message or null.
 */
function checkTeacherScope(req: AuthRequest, teacherId: string): string | null {
  if (req.user!.is_super_admin) return null;
  if (req.user!.is_admin) {
    if (!req.user!.allowed_teacher_ids?.includes(teacherId)) {
      return "ليس لديك صلاحية للوصول إلى بيانات هذا المدرس";
    }
    return null;
  }
  if (req.user!.user_type === "center" || req.user!.user_type === "staff") {
    if (!req.user!.center_teacher_ids?.includes(teacherId)) {
      return "ليس لديك صلاحية للوصول إلى بيانات هذا المدرس";
    }
    return null;
  }
  return null; // teacher — teacherFilter already scopes queries
}

// Allowed categories — mirrors the Bill model enum
const VALID_CATEGORIES = new Set(["إيجار", "رواتب سكرتارية", "أخرى"]);

// ── GET ───────────────────────────────────────────────────────────────────────

export const getBills = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);

  // Admins need financial.viewInvoices permission to access bills
  if (req.user!.is_admin && !req.user!.is_super_admin) {
    if (!req.user!.financial_permissions.includes("financial.viewInvoices")) {
      res.status(403).json({ message: "ليس لديك صلاحية لعرض الفواتير" });
      return;
    }
  }

  // Optional server-side filters (backward-compatible — all optional)
  if (req.query.year) (filter as any).billing_year = Number(req.query.year);
  if (req.query.month) (filter as any).billing_month = Number(req.query.month);
  if (req.query.category) (filter as any).category = req.query.category;

  // Pagination (optional, backward-compatible: no page/limit = return all)
  const page = req.query.page ? Math.max(1, Number(req.query.page)) : null;
  const limit = req.query.limit ? Math.min(500, Math.max(1, Number(req.query.limit))) : null;

  if (page !== null && limit !== null) {
    const skip = (page - 1) * limit;
    const [bills, total] = await Promise.all([
      Bill.find(filter).sort({ billing_year: -1, billing_month: -1, created_at: -1 }).skip(skip).limit(limit).lean(),
      Bill.countDocuments(filter),
    ]);
    res.json({ bills, total, page, limit, pages: Math.ceil(total / limit) });
  } else {
    const bills = await Bill.find(filter).sort({ billing_year: -1, billing_month: -1, created_at: -1 }).lean();
    res.json(bills);
  }
};

// ── POST /bulk ────────────────────────────────────────────────────────────────

export const addBills = async (req: AuthRequest, res: Response): Promise<void> => {
  const { bills } = req.body;
  if (!Array.isArray(bills) || bills.length === 0) {
    res.status(400).json({ message: "bills مطلوب" }); return;
  }
  if (bills.length > 100) {
    res.status(400).json({ message: "لا يمكن إضافة أكثر من 100 فاتورة في طلب واحد" }); return;
  }

  const teacherId = resolveTeacherId(req);
  const scopeErr = checkTeacherScope(req, teacherId);
  if (scopeErr) { res.status(403).json({ message: scopeErr }); return; }

  // Admins need financial.editInvoices permission to create bills
  if (req.user!.is_admin && !req.user!.is_super_admin) {
    if (!req.user!.financial_permissions.includes("financial.editInvoices")) {
      res.status(403).json({ message: "ليس لديك صلاحية لإنشاء الفواتير" });
      return;
    }
  }

  // Validate + whitelist each bill
  const safe: object[] = [];
  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    const amountErr = validatePositiveAmount(b.amount);
    if (amountErr) { res.status(400).json({ message: `فاتورة #${i + 1}: ${amountErr}` }); return; }
    const periodErr = validateBillingPeriod(b.billing_month, b.billing_year);
    if (periodErr) { res.status(400).json({ message: `فاتورة #${i + 1}: ${periodErr}` }); return; }
    if (!VALID_CATEGORIES.has(b.category)) {
      res.status(400).json({ message: `فاتورة #${i + 1}: فئة غير صالحة` }); return;
    }

    safe.push({
      title: String(b.title || "").trim(),
      amount: Number(b.amount),
      category: b.category,
      billing_month: Number(b.billing_month),
      billing_year: Number(b.billing_year),
      is_recurring: b.is_recurring === true,
      template_id: b.template_id || null,
      teacher_id: teacherId,
    });
  }

  const inserted = await Bill.insertMany(safe);
  res.status(201).json(inserted);
};

// ── POST / ────────────────────────────────────────────────────────────────────

export const addBill = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = resolveTeacherId(req);
  const scopeErr = checkTeacherScope(req, teacherId);
  if (scopeErr) { res.status(403).json({ message: scopeErr }); return; }

  // Admins need financial.editInvoices permission to create bills
  if (req.user!.is_admin && !req.user!.is_super_admin) {
    if (!req.user!.financial_permissions.includes("financial.editInvoices")) {
      res.status(403).json({ message: "ليس لديك صلاحية لإنشاء الفواتير" });
      return;
    }
  }

  const { title, amount, category, billing_month, billing_year, is_recurring, template_id } = req.body;

  if (!title || amount == null || !category || billing_month == null || billing_year == null) {
    res.status(400).json({ message: "العنوان والمبلغ والفئة والشهر والسنة مطلوبة" }); return;
  }
  const amountErr = validatePositiveAmount(amount);
  if (amountErr) { res.status(400).json({ message: amountErr }); return; }
  const periodErr = validateBillingPeriod(billing_month, billing_year);
  if (periodErr) { res.status(400).json({ message: periodErr }); return; }
  if (!VALID_CATEGORIES.has(category)) {
    res.status(400).json({ message: "فئة غير صالحة" }); return;
  }

  const bill = await Bill.create({
    title: String(title).trim(),
    amount: Number(amount),
    category,
    billing_month: Number(billing_month),
    billing_year: Number(billing_year),
    is_recurring: is_recurring === true,
    template_id: template_id || null,
    teacher_id: teacherId,
  });
  res.status(201).json(bill);
};

// ── PATCH /:id ────────────────────────────────────────────────────────────────

export const updateBill = async (req: AuthRequest, res: Response): Promise<void> => {
  // Explicit whitelist — never allow _id, teacher_id, created_at, or internal fields
  const { title, amount, category, billing_month, billing_year, is_recurring } = req.body;
  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates.title = String(title).trim();
  if (category !== undefined) {
    if (!VALID_CATEGORIES.has(category)) {
      res.status(400).json({ message: "فئة غير صالحة" }); return;
    }
    updates.category = category;
  }
  if (is_recurring !== undefined) updates.is_recurring = Boolean(is_recurring);

  if (amount !== undefined) {
    const amountErr = validatePositiveAmount(amount);
    if (amountErr) { res.status(400).json({ message: amountErr }); return; }
    updates.amount = Number(amount);
  }
  if (billing_month !== undefined) {
    const mErr = validateMonth(billing_month);
    if (mErr) { res.status(400).json({ message: mErr }); return; }
    updates.billing_month = Number(billing_month);
  }
  if (billing_year !== undefined) {
    const yErr = validateYear(billing_year);
    if (yErr) { res.status(400).json({ message: yErr }); return; }
    updates.billing_year = Number(billing_year);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "لا توجد حقول للتحديث" }); return;
  }

  const bill = await Bill.findOneAndUpdate(
    { _id: req.params.id, ...teacherFilter(req) },
    { $set: updates },
    { new: true }
  );
  if (!bill) { res.status(404).json({ message: "الفاتورة غير موجودة" }); return; }
  res.json(bill);
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────

export const deleteBill = async (req: AuthRequest, res: Response): Promise<void> => {
  const deleted = await Bill.findOneAndDelete({ _id: req.params.id, ...teacherFilter(req) });
  if (!deleted) { res.status(404).json({ message: "الفاتورة غير موجودة" }); return; }
  res.json({ message: "تم الحذف بنجاح" });
};

// ── POST /bulk-delete ─────────────────────────────────────────────────────────

export const deleteBills = async (req: AuthRequest, res: Response): Promise<void> => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ message: "ids مطلوب" }); return;
  }
  await Bill.deleteMany({ _id: { $in: ids }, ...teacherFilter(req) });
  res.json({ message: "تم الحذف بنجاح" });
};

// ── POST /generate-recurring ──────────────────────────────────────────────────

/**
 * Generate recurring bills for a specific month/year.
 *
 * FIX: Previously only stored billing_month without billing_year, causing all
 * generated bills to fall back to the schema default (current year). This broke
 * December → January cross-year generation.
 *
 * Now: caller must provide both targetMonth AND targetYear. If targetYear is
 * omitted we derive it from targetMonth vs the current month — if targetMonth
 * is January and the current month is December, we roll the year forward.
 */
export const generateRecurringBills = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const rawMonth = req.body.targetMonth;
  const rawYear = req.body.targetYear;

  // Validate month
  const monthErr = validateMonth(rawMonth);
  if (monthErr) { res.status(400).json({ message: `targetMonth: ${monthErr}` }); return; }

  const targetMonth = Number(rawMonth);

  // Derive targetYear: if provided use it; otherwise infer from month rollover
  let targetYear: number;
  if (rawYear != null) {
    const yearErr = validateYear(rawYear);
    if (yearErr) { res.status(400).json({ message: `targetYear: ${yearErr}` }); return; }
    targetYear = Number(rawYear);
  } else {
    // Infer: if targetMonth is less than the current month, the intent is next year
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    targetYear = targetMonth < currentMonth ? currentYear + 1 : currentYear;
  }

  const allRecurring = await Bill.find({ ...filter, is_recurring: true });
  if (!allRecurring.length) {
    res.status(400).json({ message: "لا توجد فواتير متكررة مسجلة بعد!" });
    return;
  }

  // Check existing bills for this exact month + year (not just month)
  const existingThisMonth = await Bill.find({
    ...filter,
    billing_month: targetMonth,
    billing_year: targetYear,
    is_recurring: true,
  });

  // Deduplicate recurring templates by title|category|amount
  const uniqueMap = new Map<string, typeof allRecurring[0]>();
  for (const b of allRecurring) {
    const key = `${b.title}|${b.category}|${b.amount}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, b);
  }

  const toInsert = Array.from(uniqueMap.values()).filter(
    (t) => !existingThisMonth.some(
      (e) => e.title === t.title && e.category === t.category && Number(e.amount) === Number(t.amount)
    )
  );

  if (!toInsert.length) {
    res.status(400).json({ message: "الفواتير المتكررة موجودة بالفعل لهذا الشهر!" });
    return;
  }

  // FIX: explicitly set BOTH billing_month AND billing_year
  const inserted = await Bill.insertMany(
    toInsert.map((b) => ({
      title: b.title,
      amount: b.amount,
      category: b.category,
      billing_month: targetMonth,
      billing_year: targetYear,   // ← was missing before
      is_recurring: true,
      teacher_id: b.teacher_id,
    }))
  );
  res.status(201).json(inserted);
};

// ── DELETE /recurring/:month ──────────────────────────────────────────────────

export const deleteRecurringBillsForMonth = async (req: AuthRequest, res: Response): Promise<void> => {
  const monthErr = validateMonth(req.params.month);
  if (monthErr) { res.status(400).json({ message: monthErr }); return; }

  const month = Number(req.params.month);
  const filter: Record<string, unknown> = {
    ...teacherFilter(req),
    billing_month: month,
    is_recurring: true,
  };

  if (req.query.year) {
    const yearErr = validateYear(req.query.year);
    if (yearErr) { res.status(400).json({ message: yearErr }); return; }
    filter.billing_year = Number(req.query.year);
  }

  await Bill.deleteMany(filter);
  res.json({ message: "تم الحذف بنجاح" });
};
