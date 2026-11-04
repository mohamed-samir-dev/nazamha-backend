import { Response } from "express";
import { Types } from "mongoose";
import { Salary } from "../models/Salary";
import { TeacherExpense } from "../models/TeacherExpense";
import { Employee } from "../models/Employee";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { BookSale } from "../models/BookSale";
import { AuditLog } from "../models/AuditLog";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { getTodayInTimezone } from "../utils/timezoneUtils";

interface PeriodBounds {
  type: "current_month" | "previous_month" | "specific_month" | "yearly" | "custom";
  month?: number;
  year?: number;
  startDate: Date;
  endDate: Date;
  prevStartDate: Date;
  prevEndDate: Date;
}

function resolveBounds(req: AuthRequest): PeriodBounds {
  const [todayYear, todayMonth] = getTodayInTimezone().split("-").map(Number);
  const type = (req.query.period as string) || "current_month";

  if (type === "previous_month") {
    let prevM = todayMonth - 1;
    let prevY = todayYear;
    if (prevM < 1) {
      prevM = 12;
      prevY--;
    }
    const startDate = new Date(Date.UTC(prevY, prevM - 1, 1));
    const endDate = new Date(Date.UTC(prevY, prevM, 0, 23, 59, 59, 999));

    let pprevM = prevM - 1;
    let pprevY = prevY;
    if (pprevM < 1) {
      pprevM = 12;
      pprevY--;
    }
    const prevStartDate = new Date(Date.UTC(pprevY, pprevM - 1, 1));
    const prevEndDate = new Date(Date.UTC(pprevY, pprevM, 0, 23, 59, 59, 999));

    return { type, month: prevM, year: prevY, startDate, endDate, prevStartDate, prevEndDate };
  }

  if (type === "specific_month") {
    const m = Number(req.query.month) || todayMonth;
    const y = Number(req.query.year) || todayYear;
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    let prevM = m - 1;
    let prevY = y;
    if (prevM < 1) {
      prevM = 12;
      prevY--;
    }
    const prevStartDate = new Date(Date.UTC(prevY, prevM - 1, 1));
    const prevEndDate = new Date(Date.UTC(prevY, prevM, 0, 23, 59, 59, 999));

    return { type, month: m, year: y, startDate, endDate, prevStartDate, prevEndDate };
  }

  if (type === "yearly") {
    const y = Number(req.query.year) || todayYear;
    const startDate = new Date(Date.UTC(y, 0, 1));
    const endDate = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));

    const prevStartDate = new Date(Date.UTC(y - 1, 0, 1));
    const prevEndDate = new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999));

    return { type, year: y, startDate, endDate, prevStartDate, prevEndDate };
  }

  if (type === "custom") {
    const fromStr = req.query.from_date as string;
    const toStr = req.query.to_date as string;
    const startDate = fromStr ? new Date(fromStr) : new Date(Date.UTC(todayYear, todayMonth - 1, 1));
    const endDate = toStr ? new Date(toStr) : new Date(Date.UTC(todayYear, todayMonth, 0, 23, 59, 59, 999));
    const span = endDate.getTime() - startDate.getTime();

    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - span);

    return { type, startDate, endDate, prevStartDate, prevEndDate };
  }

  // Default: current_month
  const startDate = new Date(Date.UTC(todayYear, todayMonth - 1, 1));
  const endDate = new Date(Date.UTC(todayYear, todayMonth, 0, 23, 59, 59, 999));

  let prevM = todayMonth - 1;
  let prevY = todayYear;
  if (prevM < 1) {
    prevM = 12;
    prevY--;
  }
  const prevStartDate = new Date(Date.UTC(prevY, prevM - 1, 1));
  const prevEndDate = new Date(Date.UTC(prevY, prevM, 0, 23, 59, 59, 999));

  return { type: "current_month", month: todayMonth, year: todayYear, startDate, endDate, prevStartDate, prevEndDate };
}

export const getFinancialOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const bounds = resolveBounds(req);

  // 1. Employee Count
  const employeeCount = await Employee.countDocuments({
    teacher_id: teacherId,
    is_active: true,
  });

  // 2. Payroll Obligations & Payments
  // For single month / yearly filter, check year & month or dates
  let salaryFilter: Record<string, unknown> = {
    teacher_id: teacherId,
    status: { $ne: "cancelled" },
  };

  if (bounds.month && bounds.year) {
    salaryFilter.year = bounds.year;
    salaryFilter.month = bounds.month;
  } else if (bounds.year && bounds.type === "yearly") {
    salaryFilter.year = bounds.year;
  } else {
    // Custom date range based on due_date or created_at
    salaryFilter.$or = [
      { due_date: { $gte: bounds.startDate, $lte: bounds.endDate } },
      { created_at: { $gte: bounds.startDate, $lte: bounds.endDate } },
    ];
  }

  const salaries = await Salary.find(salaryFilter).lean();

  let totalSalariesDue = 0;
  let totalSalariesRemaining = 0;
  let totalSalariesPaid = 0;

  for (const s of salaries) {
    const net = s.net_salary !== undefined ? s.net_salary : s.amount;
    totalSalariesDue += net;
    const paid = s.paid_amount || (s.payment_status === "paid" ? s.amount : 0);
    totalSalariesPaid += paid;
    const rem = s.remaining_amount !== undefined ? s.remaining_amount : Math.max(0, net - paid);
    totalSalariesRemaining += rem;
  }

  // 3. Expenses Obligations & Payments
  let expenseFilter: Record<string, unknown> = {
    teacher_id: teacherId,
    payment_status: { $ne: "cancelled" },
  };

  if (bounds.month && bounds.year) {
    expenseFilter.year = bounds.year;
    expenseFilter.month = bounds.month;
  } else if (bounds.year && bounds.type === "yearly") {
    expenseFilter.year = bounds.year;
  } else {
    expenseFilter.expense_date = { $gte: bounds.startDate, $lte: bounds.endDate };
  }

  const expenses = await TeacherExpense.find(expenseFilter).lean();

  let totalExpensesPaid = 0;
  let totalExpensesOutstanding = 0;
  let totalRecurringExpenses = 0;
  let totalOneTimeExpenses = 0;

  for (const e of expenses) {
    const amt = e.amount || 0;
    const paid = e.paid_amount || (e.payment_status === "paid" ? amt : 0);
    totalExpensesPaid += paid;
    const rem = e.remaining_amount !== undefined ? e.remaining_amount : Math.max(0, amt - paid);
    totalExpensesOutstanding += rem;

    if (e.is_recurring || e.is_virtual_instance || e.recurring_config_id) {
      totalRecurringExpenses += amt;
    } else {
      totalOneTimeExpenses += amt;
    }
  }

  // 4. Actual Cash Inflows (Subscriptions + Books)
  // Cash inflow comes from student subscription payments recorded with paid dates in period
  const [subsInPeriod, bookSalesInPeriod] = await Promise.all([
    MonthlySubscription.find({
      teacher_id: teacherId,
      status: "paid",
      ...(bounds.month && bounds.year
        ? { month: bounds.month, year: bounds.year }
        : bounds.year && bounds.type === "yearly"
        ? { year: bounds.year }
        : { paid_at: { $gte: bounds.startDate, $lte: bounds.endDate } }),
    })
      .select("amount discount paid_at")
      .lean(),
    BookSale.find({
      teacher_id: teacherId,
      status: "active",
      created_at: { $gte: bounds.startDate, $lte: bounds.endDate },
    })
      .select("price")
      .lean(),
  ]);

  const subscriptionInflows = subsInPeriod.reduce(
    (sum, sub) => sum + Math.max(0, (sub.amount || 0) - (sub.discount || 0)),
    0
  );
  const bookInflows = bookSalesInPeriod.reduce((sum, b) => sum + (b.price || 0), 0);
  const totalCashInflows = subscriptionInflows + bookInflows;

  // Actual Cash Outflows = Actual Paid Salaries + Actual Paid Expenses
  const totalCashOutflows = totalSalariesPaid + totalExpensesPaid;
  const netCashFlow = totalCashInflows - totalCashOutflows;

  // 5. Previous Period Comparison for Trends
  let prevSalariesPaid = 0;
  let prevExpensesPaid = 0;
  let prevCashInflows = 0;

  if (bounds.prevStartDate && bounds.prevEndDate) {
    const [prevSubs, prevBooks, prevSals, prevExps] = await Promise.all([
      MonthlySubscription.find({
        teacher_id: teacherId,
        status: "paid",
        paid_at: { $gte: bounds.prevStartDate, $lte: bounds.prevEndDate },
      })
        .select("amount discount")
        .lean(),
      BookSale.find({
        teacher_id: teacherId,
        status: "active",
        created_at: { $gte: bounds.prevStartDate, $lte: bounds.prevEndDate },
      })
        .select("price")
        .lean(),
      Salary.find({
        teacher_id: teacherId,
        status: { $ne: "cancelled" },
        "payments.payment_date": { $gte: bounds.prevStartDate, $lte: bounds.prevEndDate },
      })
        .select("payments paid_amount payment_status amount")
        .lean(),
      TeacherExpense.find({
        teacher_id: teacherId,
        payment_status: { $ne: "cancelled" },
        paid_date: { $gte: bounds.prevStartDate, $lte: bounds.prevEndDate },
      })
        .select("paid_amount amount payment_status")
        .lean(),
    ]);

    prevCashInflows =
      prevSubs.reduce(
        (sum, s) => sum + Math.max(0, (s.amount || 0) - (s.discount || 0)),
        0
      ) + prevBooks.reduce((sum, b) => sum + (b.price || 0), 0);

    prevSalariesPaid = prevSals.reduce((sum, s) => sum + (s.paid_amount || (s.payment_status === "paid" ? s.amount : 0)), 0);
    prevExpensesPaid = prevExps.reduce((sum, e) => sum + (e.paid_amount || (e.payment_status === "paid" ? e.amount : 0)), 0);
  }

  const prevCashOutflows = prevSalariesPaid + prevExpensesPaid;
  const prevNetCashFlow = prevCashInflows - prevCashOutflows;

  const netCashFlowChangePct =
    prevNetCashFlow !== 0
      ? Math.round(((netCashFlow - prevNetCashFlow) / Math.abs(prevNetCashFlow)) * 100)
      : netCashFlow > 0
      ? 100
      : 0;

  res.json({
    bounds,
    payroll: {
      total_salaries_due: totalSalariesDue,
      total_salaries_paid: totalSalariesPaid,
      total_salaries_remaining: totalSalariesRemaining,
      employee_count: employeeCount,
    },
    expenses: {
      total_expenses_paid: totalExpensesPaid,
      total_expenses_outstanding: totalExpensesOutstanding,
      recurring_expenses_total: totalRecurringExpenses,
      one_time_expenses_total: totalOneTimeExpenses,
    },
    cash_flow: {
      cash_inflows: totalCashInflows,
      subscription_inflows: subscriptionInflows,
      book_inflows: bookInflows,
      cash_outflows: totalCashOutflows,
      salaries_outflow: totalSalariesPaid,
      expenses_outflow: totalExpensesPaid,
      net_cash_flow: netCashFlow,
      comparison: {
        prev_cash_inflows: prevCashInflows,
        prev_cash_outflows: prevCashOutflows,
        prev_net_cash_flow: prevNetCashFlow,
        change_percentage: netCashFlowChangePct,
      },
    },
  });
};

export const getTransactionHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(10, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const financialActions = [
    "employee.create",
    "employee.update",
    "employee.status_change",
    "payroll.create",
    "payroll.approve",
    "payroll.pay",
    "payroll.adjust",
    "payroll.cancel",
    "expense.create",
    "expense.update",
    "expense.pay",
    "expense.cancel",
    "recurring.create",
    "recurring.update",
    "recurring.pause",
    "recurring.resume",
    "recurring.stop",
  ];

  const filter = {
    teacher_id: new Types.ObjectId(teacherId),
    action: { $in: financialActions },
  };

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    data: logs.map((l) => ({ ...l, id: String(l._id) })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
};
