import { withJobLease } from "../services/jobLease";
import { getTodayInTimezone } from "./timezoneUtils";
/**
 * Recurring Salaries & Expenses Cron
 *
 * Runs once at startup (to catch any missed months) and then every hour.
 * For each recurring salary/expense template, generates a real DB record
 * for every month from start up to the current month — if one doesn't exist yet.
 *
 * Generated records have:
 *   - is_virtual_instance: true  (so we know they were auto-generated)
 *   - payment_status: "pending"  (teacher confirms payment manually)
 */

import { Salary } from "../models/Salary";
import { TeacherExpense } from "../models/TeacherExpense";

const toYM = (year: number, month: number) => year * 100 + month;

async function generateForSalaries(nowYM: number, nowYear: number, nowMonth: number) {
  const templates = await Salary.find({ is_recurring: true, is_virtual_instance: false }).lean();

  for (const tpl of templates) {
    const startY = tpl.start_year ?? tpl.year;
    const startM = tpl.start_month ?? tpl.month;

    const endYM = tpl.end_year && tpl.end_month
      ? toYM(tpl.end_year, tpl.end_month)
      : nowYM;

    // Keep legacy generated rows until their template references are migrated.
    const existing = await Salary.find({teacher_id:tpl.teacher_id,$or:[{template_id:tpl._id},{template_id:null,is_virtual_instance:true,employee_name:tpl.employee_name}]}).select("month year").lean();
    const periods = new Set(existing.map(row=>row.year+"-"+row.month));
    let y = startY;
    let m = startM;

    while (toYM(y, m) <= Math.min(endYM, nowYM)) {
      const exists = periods.has(y+"-"+m);

      if (!exists) {
        await Salary.findOneAndUpdate({ template_id: tpl._id, month: m, year: y }, { $setOnInsert: {
          template_id: tpl._id,
          employee_name: tpl.employee_name,
          role: tpl.role,
          amount: tpl.amount,
          is_recurring: false,
          is_virtual_instance: true,
          month: m,
          year: y,
          start_month: m,
          start_year: y,
          end_month: null,
          end_year: null,
          notes: tpl.notes || "",
          payment_status: "pending",
          teacher_id: tpl.teacher_id,
        } }, { upsert: true, new: true });
      }

      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
}

async function generateForExpenses(nowYM: number) {
  const templates = await TeacherExpense.find({ is_recurring: true, is_virtual_instance: false }).lean();

  for (const tpl of templates) {
    const startY = tpl.start_year ?? tpl.year;
    const startM = tpl.start_month ?? tpl.month;

    const endYM = tpl.end_year && tpl.end_month
      ? toYM(tpl.end_year, tpl.end_month)
      : nowYM;

    // Keep legacy generated rows until their template references are migrated.
    const existing = await TeacherExpense.find({teacher_id:tpl.teacher_id,$or:[{template_id:tpl._id},{template_id:null,is_virtual_instance:true,title:tpl.title}]}).select("month year").lean();
    const periods = new Set(existing.map(row=>row.year+"-"+row.month));
    let y = startY;
    let m = startM;

    while (toYM(y, m) <= Math.min(endYM, nowYM)) {
      const exists = periods.has(y+"-"+m);

      if (!exists) {
        await TeacherExpense.findOneAndUpdate({ template_id: tpl._id, month: m, year: y }, { $setOnInsert: {
          template_id: tpl._id,
          title: tpl.title,
          expense_type: tpl.expense_type,
          category: tpl.category || "",
          amount: tpl.amount,
          is_recurring: false,
          is_virtual_instance: true,
          month: m,
          year: y,
          start_month: m,
          start_year: y,
          end_month: null,
          end_year: null,
          payment_method: tpl.payment_method || "cash",
          payment_status: "pending",
          paid_date: null,
          notes: tpl.notes || "",
          attachments: [],
          teacher_id: tpl.teacher_id,
        } }, { upsert: true, new: true });
      }

      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
}

async function runGeneration() {
  const [nowYear, nowMonth] = getTodayInTimezone().split("-").map(Number);
  const nowYM = toYM(nowYear, nowMonth);

  await generateForSalaries(nowYM, nowYear, nowMonth);
  await generateForExpenses(nowYM);
}

let isRunning = false;

export function scheduleRecurringGeneration() {
  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await withJobLease("recurring-generation", runGeneration);
      console.log("[cron:recurring] generation complete");
    } catch (err) {
      console.error("[cron:recurring] error:", err);
    } finally {
      isRunning = false;
    }
  };

  // Run immediately on startup (catches missed months)
  run();
  // Then every hour — lightweight since it uses exists() checks
  const timer = setInterval(run, 60 * 60 * 1000);
  return () => clearInterval(timer);
}
