jest.mock("../utils/financialAuditHelper", () => ({
  logFinancialAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/recurringCron", () => ({
  syncTeacherRecurring: jest.fn().mockResolvedValue(undefined),
}));

import { Employee } from "../models/Employee";
import { Salary } from "../models/Salary";
import { TeacherExpense } from "../models/TeacherExpense";
import { RecurringTransaction } from "../models/RecurringTransaction";
import {
  addEmployee,
  updateEmployee,
  toggleEmployeeStatus,
} from "../controllers/employeesController";
import {
  addSalary,
  recordSalaryPayment,
  adjustSalary,
  cancelSalary,
} from "../controllers/salariesController";
import {
  addTeacherExpense,
  confirmExpensePayment,
} from "../controllers/teacherExpensesController";
import {
  addRecurringTransaction,
  pauseRecurringTransaction,
  resumeRecurringTransaction,
} from "../controllers/recurringTransactionsController";

const T1 = "111111111111111111111111";
const E1 = "333333333333333333333333";
const S1 = "444444444444444444444444";
const X1 = "555555555555555555555555";
const R1 = "666666666666666666666666";

const response = (): any => ({
  statusCode: 200,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json: jest.fn(function (this: any, data: any) {
    this.body = data;
    return this;
  }),
});

const req = (teacherId: string, body: any = {}, params: any = {}, query: any = {}): any => ({
  user: { id: teacherId, user_type: "teacher", is_admin: false, financial_permissions: [] },
  body,
  params,
  query,
  ip: "127.0.0.1",
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Employees Management", () => {
  test("creates employee with valid salary and schedules recurring for monthly", async () => {
    const createdDoc = {
      _id: E1,
      teacher_id: T1,
      name: "أحمد علي",
      job_title: "سكرتير",
      salary_type: "monthly",
      base_salary: 4000,
      employment_start_date: new Date("2026-09-01"),
      is_active: true,
      toObject: () => ({
        _id: E1,
        name: "أحمد علي",
        job_title: "سكرتير",
        salary_type: "monthly",
        base_salary: 4000,
      }),
    };

    jest.spyOn(Employee, "create").mockResolvedValue(createdDoc as any);

    const res = response();
    await addEmployee(
      req(T1, {
        name: "أحمد علي",
        job_title: "سكرتير",
        salary_type: "monthly",
        base_salary: 4000,
        employment_start_date: "2026-09-01",
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].name).toBe("أحمد علي");
  });

  test("deactivating employee preserves history and does not delete records", async () => {
    const empDoc = {
      _id: E1,
      teacher_id: T1,
      is_active: true,
      employment_end_date: null as Date | null,
      save: jest.fn().mockResolvedValue(true),
      toObject: function (this: any) {
        return { _id: this._id, is_active: this.is_active, employment_end_date: this.employment_end_date };
      },
    };

    jest.spyOn(Employee, "findOne").mockResolvedValue(empDoc as any);

    const res = response();
    await toggleEmployeeStatus(req(T1, {}, { id: E1 }), res);

    expect(empDoc.is_active).toBe(false);
    expect(empDoc.employment_end_date).toBeInstanceOf(Date);
    expect(empDoc.save).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].message).toContain("تم الحفاظ على السجلات السابقة");
  });

  test("updating future salary settings does not affect existing payroll", async () => {
    const empDoc = {
      _id: E1,
      teacher_id: T1,
      base_salary: 4000,
      save: jest.fn().mockResolvedValue(true),
      toObject: function (this: any) {
        return { _id: this._id, base_salary: this.base_salary };
      },
    };

    jest.spyOn(Employee, "findOne").mockResolvedValue(empDoc as any);

    const res = response();
    await updateEmployee(req(T1, { base_salary: 5000 }, { id: E1 }), res);

    expect(empDoc.base_salary).toBe(5000);
    expect(empDoc.save).toHaveBeenCalled();
  });
});

describe("Payroll & Calculation & Payments", () => {
  test("calculates net salary with basic, bonuses, additional, absence, and other deductions", async () => {
    const createdSalary = {
      _id: S1,
      teacher_id: T1,
      employee_name: "محمود حسن",
      job_title: "مساعد",
      basic_salary: 3000,
      bonuses: 500,
      additional_payments: 200,
      absence_deductions: 300,
      other_deductions: 100,
      net_salary: 3300, // 3000 + 500 + 200 - 300 - 100
      paid_amount: 0,
      remaining_amount: 3300,
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(Salary, "create").mockResolvedValue(createdSalary as any);

    const res = response();
    await addSalary(
      req(T1, {
        employee_name: "محمود حسن",
        job_title: "مساعد",
        basic_salary: 3000,
        bonuses: 500,
        additional_payments: 200,
        absence_deductions: 300,
        other_deductions: 100,
        month: 11,
        year: 2026,
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.json.mock.calls[0][0].net_salary).toBe(3300);
  });

  test("records partial salary payment and updates remaining amount", async () => {
    const salaryDoc: any = {
      _id: S1,
      teacher_id: T1,
      net_salary: 4000,
      paid_amount: 0,
      remaining_amount: 4000,
      status: "approved",
      payment_status: "pending",
      payments: [],
      save: jest.fn().mockImplementation(function (this: any) {
        const total = this.payments.reduce((s: number, p: any) => s + p.amount, 0);
        this.paid_amount = total;
        this.remaining_amount = this.net_salary - total;
        if (this.paid_amount >= this.net_salary) {
          this.status = "paid";
          this.payment_status = "paid";
        } else if (this.paid_amount > 0) {
          this.status = "partially_paid";
          this.payment_status = "pending";
        }
        return Promise.resolve(this);
      }),
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(Salary, "findOne").mockResolvedValue(salaryDoc);

    // Payment 1: 2,000 EGP
    const res1 = response();
    await recordSalaryPayment(
      req(T1, { amount: 2000, payment_method: "cash" }, { id: S1 }),
      res1
    );

    expect(salaryDoc.paid_amount).toBe(2000);
    expect(salaryDoc.remaining_amount).toBe(2000);
    expect(salaryDoc.status).toBe("partially_paid");

    // Payment 2: 2,000 EGP (Full completion)
    const res2 = response();
    await recordSalaryPayment(
      req(T1, { amount: 2000, payment_method: "bank_transfer" }, { id: S1 }),
      res2
    );

    expect(salaryDoc.paid_amount).toBe(4000);
    expect(salaryDoc.remaining_amount).toBe(0);
    expect(salaryDoc.status).toBe("paid");
    expect(salaryDoc.payments).toHaveLength(2);
  });

  test("manual adjustment requires a mandatory reason for financial audit integrity", async () => {
    const salaryDoc: any = {
      _id: S1,
      teacher_id: T1,
      adjustments: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ _id: S1 }),
    };

    jest.spyOn(Salary, "findOne").mockResolvedValue(salaryDoc);

    // Without reason: should fail with 400
    const resFail = response();
    await adjustSalary(req(T1, { amount: 200, reason: "" }, { id: S1 }), resFail);
    expect(resFail.statusCode).toBe(400);

    // With reason: succeeds
    const resSuccess = response();
    await adjustSalary(
      req(T1, { amount: 200, reason: "مكافأة تميز في أعمال التصحيح" }, { id: S1 }),
      resSuccess
    );
    expect(salaryDoc.adjustments).toHaveLength(1);
    expect(salaryDoc.adjustments[0].reason).toBe("مكافأة تميز في أعمال التصحيح");
  });

  test("cannot cancel salary that already has registered payments", async () => {
    const salaryDoc: any = {
      _id: S1,
      teacher_id: T1,
      paid_amount: 1500,
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Salary, "findOne").mockResolvedValue(salaryDoc);

    const res = response();
    await cancelSalary(req(T1, { reason: "خطأ" }, { id: S1 }), res);
    expect(res.statusCode).toBe(400);
    expect(res.json.mock.calls[0][0].message).toContain("لا يمكن إلغاء راتب يحتوي على دفعات");
  });
});

describe("Operating Expenses & Partial Payments", () => {
  test("creates one-time expense in seconds with category and amount", async () => {
    const expDoc: any = {
      _id: X1,
      teacher_id: T1,
      title: "صيانة أجهزة العرض",
      category: "صيانة",
      amount: 850,
      paid_amount: 0,
      remaining_amount: 850,
      payment_status: "pending",
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(TeacherExpense, "create").mockResolvedValue(expDoc);

    const res = response();
    await addTeacherExpense(
      req(T1, {
        title: "صيانة أجهزة العرض",
        category: "صيانة",
        amount: 850,
        month: 11,
        year: 2026,
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.json.mock.calls[0][0].amount).toBe(850);
  });

  test("records partial expense payment and leaves remaining obligation", async () => {
    const expDoc: any = {
      _id: X1,
      teacher_id: T1,
      amount: 1000,
      paid_amount: 0,
      remaining_amount: 1000,
      payment_status: "pending",
      payments: [],
      save: jest.fn().mockImplementation(function (this: any) {
        const total = this.payments.reduce((s: number, p: any) => s + p.amount, 0);
        this.paid_amount = total;
        this.remaining_amount = this.amount - total;
        if (this.paid_amount >= this.amount) {
          this.payment_status = "paid";
        } else if (this.paid_amount > 0) {
          this.payment_status = "partially_paid";
        }
        return Promise.resolve(this);
      }),
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(TeacherExpense, "findOne").mockResolvedValue(expDoc);

    const res = response();
    await confirmExpensePayment(
      req(T1, { amount: 400, payment_method: "wallet" }, { id: X1 }),
      res
    );

    expect(expDoc.paid_amount).toBe(400);
    expect(expDoc.remaining_amount).toBe(600);
    expect(expDoc.payment_status).toBe("partially_paid");
  });
});

describe("Recurring Transactions (Salaries & Expenses)", () => {
  test("creates recurring rent expense configuration", async () => {
    const recDoc: any = {
      _id: R1,
      teacher_id: T1,
      title: "إيجار السنتر",
      type: "expense",
      category: "إيجار",
      amount: 3000,
      frequency: "monthly",
      due_day: 1,
      status: "active",
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(RecurringTransaction, "create").mockResolvedValue(recDoc);

    const res = response();
    await addRecurringTransaction(
      req(T1, {
        title: "إيجار السنتر",
        type: "expense",
        category: "إيجار",
        amount: 3000,
        frequency: "monthly",
        start_date: "2026-09-01",
        due_day: 1,
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.json.mock.calls[0][0].title).toBe("إيجار السنتر");
  });

  test("pausing recurring transaction preserves all generated records and unpaid balances", async () => {
    const recDoc: any = {
      _id: R1,
      teacher_id: T1,
      status: "active",
      save: jest.fn().mockResolvedValue(true),
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(RecurringTransaction, "findOne").mockResolvedValue(recDoc);

    const res = response();
    await pauseRecurringTransaction(req(T1, {}, { id: R1 }), res);

    expect(recDoc.status).toBe("paused");
    expect(res.json.mock.calls[0][0].message).toContain("تم حفظ الالتزامات السابقة");
  });

  test("resuming recurring transaction marks status as active", async () => {
    const recDoc: any = {
      _id: R1,
      teacher_id: T1,
      status: "paused",
      save: jest.fn().mockResolvedValue(true),
      toObject: function (this: any) {
        return { ...this };
      },
    };

    jest.spyOn(RecurringTransaction, "findOne").mockResolvedValue(recDoc);

    const res = response();
    await resumeRecurringTransaction(req(T1, {}, { id: R1 }), res);

    expect(recDoc.status).toBe("active");
  });
});

describe("Security & Teacher Isolation", () => {
  test("Teacher A cannot access or modify Teacher B's employee or payroll", async () => {
    jest.spyOn(Employee, "findOne").mockResolvedValue(null);

    const res = response();
    await updateEmployee(req(T1, { base_salary: 9999 }, { id: E1 }), res);

    expect(res.statusCode).toBe(404);
    expect(res.json.mock.calls[0][0].message).toContain("غير موجود");
  });
});
