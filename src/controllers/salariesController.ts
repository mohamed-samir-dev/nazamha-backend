import { Response } from "express";
import { Salary } from "../models/Salary";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import {
  validatePositiveAmount,
  validateBillingPeriod,
  validateMonthYear,
  validateMonth,
  validateYear,
} from "../utils/financialValidation";

// تحويل شهر+سنة لرقم مقارنة
const toYM = (year: number, month: number) => year * 100 + month;

// Whitelist for salary fields that callers may set
const ALLOWED_SALARY_FIELDS = [
  "employee_name",
  "role",
  "amount",
  "is_recurring",
  "month",
  "year",
  "start_month",
  "start_year",
  "end_month",
  "end_year",
  "notes",
] as const;

// ── GET / ──────────────────────────────────────────────────────────────────────

/**
 * Returns salary entries for the authenticated user's scope.
 *
 * Supports optional year + page/limit query params for bounded results.
 * If year is provided, only that year's data is returned (DB-side filter).
 * Virtual recurring expansion is capped to the requested year window to prevent
 * unbounded in-memory growth.
 */
export const getSalaries = async (req: AuthRequest, res: Response): Promise<void> => {
  const dbFilter = teacherFilter(req) as Record<string, unknown>;

  // Optional year filter: applied at DB level to reduce the result set
  const yearParam = req.query.year ? Number(req.query.year) : null;

  // Build a DB-side year range for recurring salaries:
  // A recurring salary is relevant for a year Y if:
  //   start_year <= Y AND (end_year is null OR end_year >= Y)
  // For non-recurring: year == Y
  if (yearParam) {
    dbFilter.$or = [
      { is_recurring: false, year: yearParam },
      {
        is_recurring: true,
        start_year: { $lte: yearParam },
        $or: [{ end_year: null }, { end_year: { $gte: yearParam } }],
      },
    ];
  }

  const raw = await Salary.find(dbFilter)
    .sort({ year: -1, month: -1, created_at: -1 })
    .lean();

  // Expand virtual entries for recurring salaries, bounded to yearParam if set
  const result: object[] = [];

  for (const s of raw) {
    const base = { ...s, id: String(s._id) };

    if (!s.is_recurring) {
      result.push(base);
      continue;
    }

    const now = new Date();
    const endYM = s.end_year && s.end_month
      ? toYM(s.end_year, s.end_month)
      : toYM(now.getFullYear(), now.getMonth() + 1);

    let y = s.start_year ?? s.year;
    let m = s.start_month ?? s.month;

    // If a year filter is active, clamp expansion to that year only
    const loYM = yearParam ? toYM(yearParam, 1) : toYM(y, m);
    const hiYM = yearParam ? toYM(yearParam, 12) : endYM;

    // Fast-forward to the lower bound year
    if (toYM(y, m) < loYM) {
      y = yearParam!;
      m = 1;
    }

    while (toYM(y, m) <= Math.min(endYM, hiYM)) {
      if (!raw.some(r => r.is_virtual_instance && String(r.teacher_id) === String(s.teacher_id) && r.month === m && r.year === y && (r.template_id ? String(r.template_id) === String(s._id) : (r.employee_name === s.employee_name && r.role === s.role)))) result.push({ ...base, month: m, year: y, payment_status: "pending", _virtual: true });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  res.json(result);
};

// ── POST / ────────────────────────────────────────────────────────────────────

export const addSalary = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    employee_name, role, amount, is_recurring,
    month, year, start_month, start_year, end_month, end_year, notes,
  } = req.body;

  // Required fields
  if (!employee_name?.trim() || !role?.trim()) {
    res.status(400).json({ message: "اسم الموظف والدور مطلوبان" }); return;
  }
  const amountErr = validatePositiveAmount(amount);
  if (amountErr) { res.status(400).json({ message: amountErr }); return; }

  if (is_recurring) {
    const startErr = validateMonthYear(start_month, start_year);
    if (startErr) { res.status(400).json({ message: `تاريخ البداية: ${startErr}` }); return; }
    if (end_month != null || end_year != null) {
      const endErr = validateMonthYear(end_month, end_year);
      if (endErr) { res.status(400).json({ message: `تاريخ النهاية: ${endErr}` }); return; }
      if (toYM(Number(end_year), Number(end_month)) < toYM(Number(start_year), Number(start_month))) {
        res.status(400).json({ message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية" }); return;
      }
    }
  } else {
    const periodErr = validateBillingPeriod(month, year);
    if (periodErr) { res.status(400).json({ message: periodErr }); return; }
  }

  // Build the safe payload — teacher_id is always from auth context
  const effectiveMonth = is_recurring ? Number(start_month) : Number(month);
  const effectiveYear  = is_recurring ? Number(start_year)  : Number(year);

  const salary = await Salary.create({
    employee_name: String(employee_name).trim(),
    role: String(role).trim(),
    amount: Number(amount),
    is_recurring: is_recurring === true,
    month: effectiveMonth,
    year: effectiveYear,
    start_month: is_recurring ? Number(start_month) : effectiveMonth,
    start_year: is_recurring ? Number(start_year) : effectiveYear,
    end_month: is_recurring && end_month != null ? Number(end_month) : null,
    end_year: is_recurring && end_year != null ? Number(end_year) : null,
    notes: notes ? String(notes).trim() : "",
    teacher_id: req.user!.id,  // always from auth — never client-supplied
  });
  res.status(201).json(salary);
};

// ── PATCH /:id ────────────────────────────────────────────────────────────────

export const updateSalary = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === "undefined") { res.status(400).json({ message: "معرّف غير صالح" }); return; }

  const {
    employee_name, role, amount, is_recurring,
    month, year, start_month, start_year, end_month, end_year, notes,
  } = req.body;

  const updates: Record<string, unknown> = {};

  if (employee_name !== undefined) updates.employee_name = String(employee_name).trim();
  if (role !== undefined) updates.role = String(role).trim();
  if (notes !== undefined) updates.notes = String(notes).trim();
  if (is_recurring !== undefined) updates.is_recurring = Boolean(is_recurring);

  if (amount !== undefined) {
    const amountErr = validatePositiveAmount(amount);
    if (amountErr) { res.status(400).json({ message: amountErr }); return; }
    updates.amount = Number(amount);
  }

  if (is_recurring) {
    if (start_month !== undefined || start_year !== undefined) {
      const startErr = validateMonthYear(start_month ?? req.body.month, start_year ?? req.body.year);
      if (startErr) { res.status(400).json({ message: `تاريخ البداية: ${startErr}` }); return; }
      updates.start_month = Number(start_month);
      updates.start_year = Number(start_year);
      updates.month = Number(start_month);
      updates.year = Number(start_year);
    }
    if (end_month !== undefined) updates.end_month = end_month != null ? Number(end_month) : null;
    if (end_year !== undefined) updates.end_year = end_year != null ? Number(end_year) : null;
  } else {
    if (month !== undefined || year !== undefined) {
      const periodErr = validateBillingPeriod(month, year);
      if (periodErr) { res.status(400).json({ message: periodErr }); return; }
      updates.month = Number(month);
      updates.year = Number(year);
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "لا توجد حقول للتحديث" }); return;
  }

  const salary = await Salary.findOneAndUpdate(
    { _id: id, ...teacherFilter(req) },
    { $set: updates },     // explicit $set — never allow operator injection
    { new: true }
  );
  if (!salary) { res.status(404).json({ message: "السجل غير موجود" }); return; }
  res.json(salary);
};

// ── PATCH /:id/pay ───────────────────────────────────────────────────────────

export const confirmSalaryPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === "undefined") { res.status(400).json({ message: "معرّف غير صالح" }); return; }
  const source = await Salary.findOne({ _id: id, ...teacherFilter(req) });
  if (!source) { res.status(404).json({ message: "السجل غير موجود" }); return; }
  if (!source.is_recurring) {
    const paid = await Salary.findOneAndUpdate({ _id: id, ...teacherFilter(req) }, { $set: { payment_status: "paid" } }, { new: true });
    res.json(paid); return;
  }
  const month = Number(req.body.month), year = Number(req.body.year);
  if (validateMonthYear(month, year)) { res.status(400).json({ message: "حدد شهر وسنة الدفع" }); return; }
  const period = toYM(year, month);
  if (period < toYM(source.start_year ?? source.year, source.start_month ?? source.month) || (source.end_year && source.end_month && period > toYM(source.end_year, source.end_month))) { res.status(400).json({ message: "الشهر خارج فترة التكرار" }); return; }
  const paid = await Salary.findOneAndUpdate(
    { template_id: source._id, month, year, teacher_id: source.teacher_id },
    { $set: { payment_status: "paid" }, $setOnInsert: {
      employee_name: source.employee_name, role: source.role, amount: source.amount, notes: source.notes,
      is_recurring: false, is_virtual_instance: true,
    } }, { upsert: true, new: true, runValidators: true }
  );
  res.json(paid);
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────

export const deleteSalary = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === "undefined") { res.status(400).json({ message: "معرّف غير صالح" }); return; }
  const deleted = await Salary.findOneAndDelete({ _id: id, ...teacherFilter(req) });
  if (!deleted) { res.status(404).json({ message: "السجل غير موجود" }); return; }
  res.json({ message: "تم الحذف بنجاح" });
};
