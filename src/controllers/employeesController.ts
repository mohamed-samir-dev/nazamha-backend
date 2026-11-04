import { Response } from "express";
import { Types } from "mongoose";
import { Employee, SalaryType } from "../models/Employee";
import { Salary } from "../models/Salary";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { validatePositiveAmount } from "../utils/financialValidation";
import { logFinancialAction } from "../utils/financialAuditHelper";
import { syncTeacherRecurring } from "../utils/recurringCron";

export const getEmployees = async (req: AuthRequest, res: Response): Promise<void> => {
  const dbFilter = teacherFilter(req) as Record<string, unknown>;

  const statusParam = req.query.status as string | undefined;
  if (statusParam === "active") {
    dbFilter.is_active = true;
  } else if (statusParam === "inactive") {
    dbFilter.is_active = false;
  }

  const search = req.query.search as string | undefined;
  if (search?.trim()) {
    const s = search.trim();
    dbFilter.$or = [
      { name: { $regex: s, $options: "i" } },
      { phone: { $regex: s, $options: "i" } },
      { job_title: { $regex: s, $options: "i" } },
    ];
  }

  const salaryType = req.query.salary_type as SalaryType | undefined;
  if (salaryType) {
    dbFilter.salary_type = salaryType;
  }

  const employees = await Employee.find(dbFilter).sort({ is_active: -1, created_at: -1 }).lean();
  res.json(employees.map(e => ({ ...e, id: String(e._id) })));
};

export const getEmployeeById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف موظف غير صالح" });
    return;
  }

  const employee = await Employee.findOne({ _id: id, ...teacherFilter(req) }).lean();
  if (!employee) {
    res.status(404).json({ message: "الموظف غير موجود" });
    return;
  }

  res.json({ ...employee, id: String(employee._id) });
};

export const getEmployeeHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف موظف غير صالح" });
    return;
  }

  const employee = await Employee.findOne({ _id: id, ...teacherFilter(req) }).lean();
  if (!employee) {
    res.status(404).json({ message: "الموظف غير موجود" });
    return;
  }

  const payrollHistory = await Salary.find({
    teacher_id: employee.teacher_id,
    $or: [{ employee_id: employee._id }, { employee_name: employee.name }],
  })
    .sort({ year: -1, month: -1 })
    .lean();

  res.json({
    employee: { ...employee, id: String(employee._id) },
    history: payrollHistory.map(p => ({ ...p, id: String(p._id) })),
  });
};

export const addEmployee = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    name,
    phone,
    job_title,
    employment_start_date,
    employment_end_date,
    salary_type,
    base_salary,
    payment_day,
    notes,
  } = req.body;

  if (!name?.trim()) {
    res.status(400).json({ message: "اسم الموظف مطلوب" });
    return;
  }
  if (!job_title?.trim()) {
    res.status(400).json({ message: "المسمى الوظيفي مطلوب" });
    return;
  }

  const salaryErr = validatePositiveAmount(base_salary);
  if (salaryErr) {
    res.status(400).json({ message: salaryErr });
    return;
  }

  if (!employment_start_date) {
    res.status(400).json({ message: "تاريخ بدء العمل مطلوب" });
    return;
  }

  const validTypes = ["monthly", "daily", "hourly", "per_lesson", "percentage", "fixed_plus_bonus"];
  const type = validTypes.includes(salary_type) ? salary_type : "monthly";

  const employee = await Employee.create({
    teacher_id: req.user!.id,
    name: String(name).trim(),
    phone: phone ? String(phone).trim() : "",
    job_title: String(job_title).trim(),
    employment_start_date: new Date(employment_start_date),
    employment_end_date: employment_end_date ? new Date(employment_end_date) : null,
    salary_type: type,
    base_salary: Number(base_salary),
    payment_day: payment_day ? Math.min(Math.max(Number(payment_day), 1), 31) : 1,
    notes: notes ? String(notes).trim() : "",
    is_active: true,
    is_recurring: type === "monthly",
  });

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "employee.create",
    resourceType: "employee",
    resourceId: String(employee._id),
    newData: employee.toObject(),
  });

  // If monthly salary, trigger sync immediately so the teacher sees the current period ready
  if (type === "monthly") {
    syncTeacherRecurring(req.user!.id).catch(err =>
      console.error("[addEmployee] recurring sync error:", err)
    );
  }

  res.status(201).json({ ...employee.toObject(), id: String(employee._id) });
};

export const updateEmployee = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const employee = await Employee.findOne({ _id: id, ...teacherFilter(req) });
  if (!employee) {
    res.status(404).json({ message: "الموظف غير موجود" });
    return;
  }

  const oldData = employee.toObject();
  const {
    name,
    phone,
    job_title,
    employment_start_date,
    employment_end_date,
    salary_type,
    base_salary,
    payment_day,
    notes,
    is_active,
  } = req.body;

  if (name !== undefined) employee.name = String(name).trim();
  if (phone !== undefined) employee.phone = String(phone).trim();
  if (job_title !== undefined) employee.job_title = String(job_title).trim();
  if (notes !== undefined) employee.notes = String(notes).trim();
  if (employment_start_date) employee.employment_start_date = new Date(employment_start_date);
  if (employment_end_date !== undefined) {
    employee.employment_end_date = employment_end_date ? new Date(employment_end_date) : null;
  }
  if (payment_day !== undefined) {
    employee.payment_day = Math.min(Math.max(Number(payment_day), 1), 31);
  }
  if (is_active !== undefined) employee.is_active = Boolean(is_active);

  if (salary_type !== undefined) {
    const validTypes = ["monthly", "daily", "hourly", "per_lesson", "percentage", "fixed_plus_bonus"];
    if (validTypes.includes(salary_type)) {
      employee.salary_type = salary_type as SalaryType;
      employee.is_recurring = salary_type === "monthly";
    }
  }

  if (base_salary !== undefined) {
    const salaryErr = validatePositiveAmount(base_salary);
    if (salaryErr) {
      res.status(400).json({ message: salaryErr });
      return;
    }
    // Updating base_salary applies to future periods only; historical records remain preserved.
    employee.base_salary = Number(base_salary);
  }

  await employee.save();

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "employee.update",
    resourceType: "employee",
    resourceId: String(employee._id),
    oldData,
    newData: employee.toObject(),
  });

  res.json({ ...employee.toObject(), id: String(employee._id) });
};

export const toggleEmployeeStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "معرّف غير صالح" });
    return;
  }

  const employee = await Employee.findOne({ _id: id, ...teacherFilter(req) });
  if (!employee) {
    res.status(404).json({ message: "الموظف غير موجود" });
    return;
  }

  const oldStatus = employee.is_active;
  employee.is_active = !oldStatus;
  if (!employee.is_active && !employee.employment_end_date) {
    employee.employment_end_date = new Date();
  } else if (employee.is_active) {
    employee.employment_end_date = null;
  }

  await employee.save();

  await logFinancialAction({
    req,
    teacherId: req.user!.id,
    action: "employee.status_change",
    resourceType: "employee",
    resourceId: String(employee._id),
    oldData: { is_active: oldStatus },
    newData: { is_active: employee.is_active },
  });

  res.json({
    message: employee.is_active ? "تم تفعيل الموظف بنجاح" : "تم إلغاء تفعيل الموظف (تم الحفاظ على السجلات السابقة)",
    employee: { ...employee.toObject(), id: String(employee._id) },
  });
};
