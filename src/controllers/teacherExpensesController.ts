import { Response } from "express";
import { TeacherExpense } from "../models/TeacherExpense";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import {
  validatePositiveAmount,
  validateMonthYear,
} from "../utils/financialValidation";

// تحويل شهر+سنة لرقم مقارنة
const toYM = (year: number, month: number) => year * 100 + month;

// ── GET / ──────────────────────────────────────────────────────────────────────

/**
 * Returns expense entries for the authenticated teacher.
 * Supports optional year, month, expense_type, and payment_status filters.
 * Expands recurring expenses virtually.
 */
export const getTeacherExpenses = async (req: AuthRequest, res: Response): Promise<void> => {
  const dbFilter = teacherFilter(req) as Record<string, unknown>;

  // Optional filters
  const yearParam = req.query.year ? Number(req.query.year) : null;
  const monthParam = req.query.month ? Number(req.query.month) : null;
  const typeParam = req.query.expense_type as string | undefined;
  const statusParam = req.query.payment_status as string | undefined;

  // Build DB-side filters
  if (yearParam && monthParam) {
    dbFilter.$or = [
      { is_recurring: false, year: yearParam, month: monthParam },
      {
        is_recurring: true,
        start_year: { $lte: yearParam },
        $or: [{ end_year: null }, { end_year: { $gte: yearParam } }],
      },
    ];
  } else if (yearParam) {
    dbFilter.$or = [
      { is_recurring: false, year: yearParam },
      {
        is_recurring: true,
        start_year: { $lte: yearParam },
        $or: [{ end_year: null }, { end_year: { $gte: yearParam } }],
      },
    ];
  }

  if (typeParam) {
    dbFilter.expense_type = typeParam;
  }

  // Filter after recurring expansion so a paid instance still suppresses its template.

  const raw = await TeacherExpense.find(dbFilter)
    .sort({ year: -1, month: -1, created_at: -1 })
    .lean();

  // Expand virtual entries for recurring expenses
  const result: object[] = [];

  for (const exp of raw) {
    const base = { ...exp, id: String(exp._id) };

    if (!exp.is_recurring) {
      result.push(base);
      continue;
    }

    const now = new Date();
    const endYM = exp.end_year && exp.end_month
      ? toYM(exp.end_year, exp.end_month)
      : toYM(now.getFullYear(), now.getMonth() + 1);

    let y = exp.start_year ?? exp.year;
    let m = exp.start_month ?? exp.month;

    // If year/month filter is active, clamp expansion
    const loYM = yearParam && monthParam 
      ? toYM(yearParam, monthParam) 
      : yearParam 
      ? toYM(yearParam, 1) 
      : toYM(y, m);
    
    const hiYM = yearParam && monthParam
      ? toYM(yearParam, monthParam)
      : yearParam 
      ? toYM(yearParam, 12) 
      : endYM;

    // Fast-forward to the lower bound
    if (toYM(y, m) < loYM) {
      if (yearParam && monthParam) {
        y = yearParam;
        m = monthParam;
      } else if (yearParam) {
        y = yearParam;
        m = 1;
      }
    }

    while (toYM(y, m) <= Math.min(endYM, hiYM)) {
      if (!raw.some(r => r.is_virtual_instance && String(r.teacher_id) === String(exp.teacher_id) && r.month === m && r.year === y && (r.template_id ? String(r.template_id) === String(exp._id) : (r.title === exp.title && r.expense_type === exp.expense_type)))) result.push({ ...base, month: m, year: y, payment_status: "pending", _virtual: true });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  res.json(statusParam ? result.filter(item => (item as { payment_status?: string }).payment_status === statusParam) : result);
};

// ── GET /statistics ────────────────────────────────────────────────────────────

/**
 * Returns statistics for expenses (total by type, by month, by status, etc.)
 */
export const getExpenseStatistics = async (req: AuthRequest, res: Response): Promise<void> => {
  const dbFilter = teacherFilter(req) as Record<string, unknown>;
  const yearParam = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  dbFilter.$or = [
    { is_recurring: false, year: yearParam },
    {
      is_recurring: true,
      start_year: { $lte: yearParam },
      $or: [{ end_year: null }, { end_year: { $gte: yearParam } }],
    },
  ];

  const expenses = await TeacherExpense.find(dbFilter).lean();

  // Expand recurring expenses for the year
  const expanded: any[] = [];
  for (const exp of expenses) {
    if (!exp.is_recurring) {
      expanded.push(exp);
      continue;
    }

    const endYM = exp.end_year && exp.end_month
      ? toYM(exp.end_year, exp.end_month)
      : toYM(yearParam, 12);

    let y = exp.start_year ?? exp.year;
    let m = exp.start_month ?? exp.month;

    if (y < yearParam) { y = yearParam; m = 1; }

    while (y === yearParam && toYM(y, m) <= endYM) {
      if (!expenses.some(r => r.is_virtual_instance && String(r.teacher_id) === String(exp.teacher_id) && r.month === m && r.year === y && (r.template_id ? String(r.template_id) === String(exp._id) : r.title === exp.title && r.expense_type === exp.expense_type))) expanded.push({ ...exp, month: m, year: y });
      m++;
      if (m > 12) break;
    }
  }

  // Calculate statistics
  const totalExpenses = expanded.reduce((sum, e) => sum + e.amount, 0);
  
  const byType: Record<string, number> = {};
  const byMonth: Record<number, number> = {};
  const byStatus: Record<string, number> = { paid: 0, pending: 0, overdue: 0 };

  for (const exp of expanded) {
    byType[exp.expense_type] = (byType[exp.expense_type] || 0) + exp.amount;
    byMonth[exp.month] = (byMonth[exp.month] || 0) + exp.amount;
    byStatus[exp.payment_status] = (byStatus[exp.payment_status] || 0) + exp.amount;
  }

  res.json({
    year: yearParam,
    totalExpenses,
    totalCount: expanded.length,
    byType,
    byMonth,
    byStatus,
  });
};

// ── POST / ────────────────────────────────────────────────────────────────────

export const addTeacherExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    title, expense_type, category, amount, is_recurring,
    month, year, start_month, start_year, end_month, end_year,
    payment_method, payment_status, paid_date, notes, attachments,
  } = req.body;

  // Required fields
  if (!title?.trim()) {
    res.status(400).json({ message: "العنوان مطلوب" }); 
    return;
  }

  if (!expense_type) {
    res.status(400).json({ message: "نوع المصروف مطلوب" }); 
    return;
  }

  const validTypes = ["rent", "utilities", "maintenance", "supplies", "transport", "food", "other"];
  if (!validTypes.includes(expense_type)) {
    res.status(400).json({ message: "نوع المصروف غير صالح" }); 
    return;
  }

  const amountErr = validatePositiveAmount(amount);
  if (amountErr) { 
    res.status(400).json({ message: amountErr }); 
    return; 
  }

  if (is_recurring) {
    const startErr = validateMonthYear(start_month, start_year);
    if (startErr) { 
      res.status(400).json({ message: `تاريخ البداية: ${startErr}` }); 
      return; 
    }
    if (end_month != null || end_year != null) {
      const endErr = validateMonthYear(end_month, end_year);
      if (endErr) { 
        res.status(400).json({ message: `تاريخ النهاية: ${endErr}` }); 
        return; 
      }
      if (toYM(Number(end_year), Number(end_month)) < toYM(Number(start_year), Number(start_month))) {
        res.status(400).json({ message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية" }); 
        return;
      }
    }
  } else {
    const periodErr = validateMonthYear(month, year);
    if (periodErr) { 
      res.status(400).json({ message: periodErr }); 
      return; 
    }
  }

  const effectiveMonth = is_recurring ? Number(start_month) : Number(month);
  const effectiveYear = is_recurring ? Number(start_year) : Number(year);

  const expense = await TeacherExpense.create({
    title: String(title).trim(),
    expense_type,
    category: category ? String(category).trim() : "",
    amount: Number(amount),
    is_recurring: is_recurring === true,
    month: effectiveMonth,
    year: effectiveYear,
    start_month: is_recurring ? Number(start_month) : effectiveMonth,
    start_year: is_recurring ? Number(start_year) : effectiveYear,
    end_month: is_recurring && end_month != null ? Number(end_month) : null,
    end_year: is_recurring && end_year != null ? Number(end_year) : null,
    payment_method: payment_method || "cash",
    payment_status: payment_status || "pending",
    paid_date: paid_date ? new Date(paid_date) : null,
    notes: notes ? String(notes).trim() : "",
    attachments: attachments || [],
    teacher_id: req.user!.id,
  });

  res.status(201).json(expense);
};

// ── PATCH /:id ────────────────────────────────────────────────────────────────

export const updateTeacherExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === "undefined") { 
    res.status(400).json({ message: "معرّف غير صالح" }); 
    return; 
  }

  const {
    title, expense_type, category, amount, is_recurring,
    month, year, start_month, start_year, end_month, end_year,
    payment_method, payment_status, paid_date, notes, attachments,
  } = req.body;

  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates.title = String(title).trim();
  if (expense_type !== undefined) {
    const validTypes = ["rent", "utilities", "maintenance", "supplies", "transport", "food", "other"];
    if (!validTypes.includes(expense_type)) {
      res.status(400).json({ message: "نوع المصروف غير صالح" }); 
      return;
    }
    updates.expense_type = expense_type;
  }
  if (category !== undefined) updates.category = String(category).trim();
  if (notes !== undefined) updates.notes = String(notes).trim();
  if (is_recurring !== undefined) updates.is_recurring = Boolean(is_recurring);
  if (payment_method !== undefined) updates.payment_method = payment_method;
  if (payment_status !== undefined) updates.payment_status = payment_status;
  if (paid_date !== undefined) updates.paid_date = paid_date ? new Date(paid_date) : null;
  if (attachments !== undefined) updates.attachments = attachments;

  if (amount !== undefined) {
    const amountErr = validatePositiveAmount(amount);
    if (amountErr) { 
      res.status(400).json({ message: amountErr }); 
      return; 
    }
    updates.amount = Number(amount);
  }

  if (is_recurring) {
    if (start_month !== undefined || start_year !== undefined) {
      const startErr = validateMonthYear(start_month, start_year);
      if (startErr) { 
        res.status(400).json({ message: `تاريخ البداية: ${startErr}` }); 
        return; 
      }
      updates.start_month = Number(start_month);
      updates.start_year = Number(start_year);
      updates.month = Number(start_month);
      updates.year = Number(start_year);
    }
    if (end_month !== undefined) updates.end_month = end_month != null ? Number(end_month) : null;
    if (end_year !== undefined) updates.end_year = end_year != null ? Number(end_year) : null;
  } else {
    if (month !== undefined || year !== undefined) {
      const periodErr = validateMonthYear(month, year);
      if (periodErr) { 
        res.status(400).json({ message: periodErr }); 
        return; 
      }
      updates.month = Number(month);
      updates.year = Number(year);
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "لا توجد حقول للتحديث" }); 
    return;
  }

  const expense = await TeacherExpense.findOneAndUpdate(
    { _id: id, ...teacherFilter(req) },
    { $set: updates },
    { new: true }
  );

  if (!expense) { 
    res.status(404).json({ message: "السجل غير موجود" }); 
    return; 
  }

  res.json(expense);
};

// ── PATCH /:id/pay ───────────────────────────────────────────────────────────

export const confirmExpensePayment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === "undefined") { res.status(400).json({ message: "معرّف غير صالح" }); return; }
  const source = await TeacherExpense.findOne({ _id: id, ...teacherFilter(req) });
  if (!source) { res.status(404).json({ message: "السجل غير موجود" }); return; }
  if (!source.is_recurring) {
    const paid = await TeacherExpense.findOneAndUpdate({ _id: id, ...teacherFilter(req) }, { $set: { payment_status: "paid", paid_date: new Date() } }, { new: true });
    res.json(paid); return;
  }
  const month = Number(req.body.month), year = Number(req.body.year);
  if (validateMonthYear(month, year)) { res.status(400).json({ message: "حدد شهر وسنة الدفع" }); return; }
  const period = toYM(year, month);
  if (period < toYM(source.start_year ?? source.year, source.start_month ?? source.month) || (source.end_year && source.end_month && period > toYM(source.end_year, source.end_month))) { res.status(400).json({ message: "الشهر خارج فترة التكرار" }); return; }
  const paid = await TeacherExpense.findOneAndUpdate(
    { template_id: source._id, month, year, teacher_id: source.teacher_id },
    { $set: { payment_status: "paid", paid_date: new Date() }, $setOnInsert: {
      title: source.title, expense_type: source.expense_type, amount: source.amount, notes: source.notes,
      is_recurring: false, is_virtual_instance: true,
    } }, { upsert: true, new: true, runValidators: true }
  );
  res.json(paid);
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────

export const deleteTeacherExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || id === "undefined") { 
    res.status(400).json({ message: "معرّف غير صالح" }); 
    return; 
  }

  const deleted = await TeacherExpense.findOneAndDelete({ 
    _id: id, 
    ...teacherFilter(req) 
  });

  if (!deleted) { 
    res.status(404).json({ message: "السجل غير موجود" }); 
    return; 
  }

  res.json({ message: "تم الحذف بنجاح" });
};
