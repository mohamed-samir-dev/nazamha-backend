import { Response } from "express";
import { Types } from "mongoose";
import { RecurringTransaction, RecurringType, RecurringFrequency } from "../models/RecurringTransaction";
import { TeacherExpense } from "../models/TeacherExpense";
import { Salary } from "../models/Salary";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { validatePositiveAmount } from "../utils/financialValidation";
import { logFinancialAction } from "../utils/financialAuditHelper";
import { syncTeacherRecurring } from "../utils/recurringCron";

export const getRecurringTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  const dbFilter = teacherFilter(req) as Record<string, unknown>;

  const typeParam = req.query.type as RecurringType | undefined;
  if (typeParam) dbFilter.type = typeParam;

  const statusParam = req.query.status as string | undefined;
  if (statusParam) dbFilter.status = statusParam;

  const list = await RecurringTransaction.find(dbFilter).sort({ status: 1, created_at: -1 }).lean();

  // Compute next due date for each
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const result = list.map((item) => {
    const dueDay = Math.min(Math.max(item.due_day || 1, 1), 28);
    let nextDueDate = new Date(currentYear, currentMonth - 1, dueDay);
    if (now > nextDueDate) {
      nextDueDate = new Date(currentYear, currentMonth, dueDay);
    }

    return {
      ...item,
      id: String(item._id),
      next_due_date: nextDueDate,
    };
  });

  res.json(result);
};

export const getRecurringById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const item = await RecurringTransaction.findOne({ _id: id, ...teacherFilter(req) }).lean();
  if (!item) {
    res.status(404).json({ message: "المعاملة المتكررة غير موجودة" });
    return;
  }

  res.json({ ...item, id: String(item._id) });
};

export const addRecurringTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    title,
    type,
    employee_id,
    category,
    amount,
    frequency,
    start_date,
    end_date,
    due_day,
    payment_method_preference,
    notes,
  } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ message: "اسم المعاملة المتكررة مطلوب" });
    return;
  }

  const recType = type === "salary" ? "salary" : "expense";

  const amountErr = validatePositiveAmount(amount);
  if (amountErr) {
    res.status(400).json({ message: amountErr });
    return;
  }

  if (!start_date) {
    res.status(400).json({ message: "تاريخ البدء مطلوب" });
    return;
  }

  const validFrequencies: RecurringFrequency[] = ["monthly", "weekly", "quarterly", "semi_annual", "yearly"];
  const freq: RecurringFrequency = validFrequencies.includes(frequency) ? frequency : "monthly";

  const recurring = await RecurringTransaction.create({
    teacher_id: req.user!.id,
    title: String(title).trim(),
    type: recType,
    employee_id: employee_id && Types.ObjectId.isValid(employee_id) ? new Types.ObjectId(employee_id) : null,
    category: category ? String(category).trim() : "مصروفات أخرى",
    amount: Number(amount),
    frequency: freq,
    start_date: new Date(start_date),
    end_date: end_date ? new Date(end_date) : null,
    due_day: due_day ? Math.min(Math.max(Number(due_day), 1), 31) : 1,
    payment_method_preference: payment_method_preference || "cash",
    notes: notes ? String(notes).trim() : "",
    status: "active",
  });

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "recurring.create",
    resourceType: "recurring",
    resourceId: String(recurring._id),
    newData: recurring.toObject(),
  });

  // Trigger sync in background so the obligations are immediately generated
  syncTeacherRecurring(req.user!.id).catch((err) =>
    console.error("[addRecurringTransaction] sync error:", err)
  );

  res.status(201).json({ ...recurring.toObject(), id: String(recurring._id) });
};

export const updateRecurringTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const recurring = await RecurringTransaction.findOne({ _id: id, ...teacherFilter(req) });
  if (!recurring) {
    res.status(404).json({ message: "المعاملة المتكررة غير موجودة" });
    return;
  }

  const oldData = recurring.toObject();
  const {
    title,
    category,
    amount,
    frequency,
    start_date,
    end_date,
    due_day,
    payment_method_preference,
    notes,
  } = req.body;

  if (title !== undefined) recurring.title = String(title).trim();
  if (category !== undefined) recurring.category = String(category).trim();
  if (notes !== undefined) recurring.notes = String(notes).trim();
  if (start_date) recurring.start_date = new Date(start_date);
  if (end_date !== undefined) recurring.end_date = end_date ? new Date(end_date) : null;
  if (due_day !== undefined) recurring.due_day = Math.min(Math.max(Number(due_day), 1), 31);
  if (payment_method_preference !== undefined) recurring.payment_method_preference = payment_method_preference;

  if (frequency !== undefined) {
    const validFrequencies: RecurringFrequency[] = ["monthly", "weekly", "quarterly", "semi_annual", "yearly"];
    if (validFrequencies.includes(frequency)) recurring.frequency = frequency;
  }

  if (amount !== undefined) {
    const amountErr = validatePositiveAmount(amount);
    if (amountErr) {
      res.status(400).json({ message: amountErr });
      return;
    }
    // Changing the recurring amount applies to future periods only;
    // previous paid and approved records are never touched.
    recurring.amount = Number(amount);
  }

  await recurring.save();

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "recurring.update",
    resourceType: "recurring",
    resourceId: String(recurring._id),
    oldData,
    newData: recurring.toObject(),
  });

  res.json({ ...recurring.toObject(), id: String(recurring._id) });
};

export const pauseRecurringTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const recurring = await RecurringTransaction.findOne({ _id: id, ...teacherFilter(req) });
  if (!recurring) {
    res.status(404).json({ message: "المعاملة المتكررة غير موجودة" });
    return;
  }

  recurring.status = "paused";
  await recurring.save();

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "recurring.pause",
    resourceType: "recurring",
    resourceId: String(recurring._id),
  });

  res.json({
    message: "تم إيقاف التكرار مؤقتاً (تم حفظ الالتزامات السابقة والأرصدة غير المدفوعة)",
    recurring: { ...recurring.toObject(), id: String(recurring._id) },
  });
};

export const resumeRecurringTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const recurring = await RecurringTransaction.findOne({ _id: id, ...teacherFilter(req) });
  if (!recurring) {
    res.status(404).json({ message: "المعاملة المتكررة غير موجودة" });
    return;
  }

  recurring.status = "active";
  await recurring.save();

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "recurring.resume",
    resourceType: "recurring",
    resourceId: String(recurring._id),
  });

  // Trigger sync in background
  syncTeacherRecurring(req.user!.id).catch((err) =>
    console.error("[resumeRecurringTransaction] sync error:", err)
  );

  res.json({
    message: "تم استئناف التكرار بنجاح",
    recurring: { ...recurring.toObject(), id: String(recurring._id) },
  });
};

export const stopRecurringTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const recurring = await RecurringTransaction.findOne({ _id: id, ...teacherFilter(req) });
  if (!recurring) {
    res.status(404).json({ message: "المعاملة المتكررة غير موجودة" });
    return;
  }

  recurring.status = "stopped";
  if (!recurring.end_date) {
    recurring.end_date = new Date();
  }
  await recurring.save();

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "recurring.stop",
    resourceType: "recurring",
    resourceId: String(recurring._id),
  });

  res.json({
    message: "تم إنهاء التكرار بشكل نهائي (تم الحفاظ على السجلات السابقة)",
    recurring: { ...recurring.toObject(), id: String(recurring._id) },
  });
};

export const syncRecurring = async (req: AuthRequest, res: Response): Promise<void> => {
  await syncTeacherRecurring(req.user!.id);
  res.json({ message: "تمت مزامنة المعاملات والالتزامات المتكررة بنجاح" });
};

export const getRecurringOccurrences = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const recurring = await RecurringTransaction.findOne({ _id: id, ...teacherFilter(req) }).lean();
  if (!recurring) {
    res.status(404).json({ message: "المعاملة المتكررة غير موجودة" });
    return;
  }

  let occurrences: any[] = [];
  if (recurring.type === "expense") {
    occurrences = await TeacherExpense.find({
      teacher_id: recurring.teacher_id,
      recurring_config_id: recurring._id,
    })
      .sort({ year: -1, month: -1 })
      .lean();
  } else if (recurring.type === "salary") {
    occurrences = await Salary.find({
      teacher_id: recurring.teacher_id,
      recurring_config_id: recurring._id,
    })
      .sort({ year: -1, month: -1 })
      .lean();
  }

  res.json({
    recurring: { ...recurring, id: String(recurring._id) },
    occurrences: occurrences.map((o) => ({ ...o, id: String(o._id) })),
  });
};
