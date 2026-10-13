import type { ClientSession } from "mongoose";
import { series } from "./atomicController";
import { MonthlySubscription, SubscriptionStatus } from "../models/MonthlySubscription";
import { Student } from "../models/Student";
import { Teacher } from "../models/Teacher";
import { Group } from "../models/Group";

function resolveMonthYearsFromPairs(
  pairs: { month: number; year: number }[],
  startMonth: number,
  startYear: number
): { month: number; year: number; status: SubscriptionStatus }[] {
  if (pairs.length === 0) return [];
  const startDate = startYear * 100 + startMonth;
  return pairs
    .filter(({ month, year }) => year * 100 + month >= startDate)
    .map(({ month, year }) => ({ month, year, status: "due" as SubscriptionStatus }));
}

function resolveMonthYears(activeMonths: number[], startMonth: number, startYear: number): { month: number; year: number; status: SubscriptionStatus }[] {
  if (activeMonths.length === 0) return [];

  const sorted = [...activeMonths].sort((a, b) => a - b);
  const startDate = startYear * 100 + startMonth;

  let anchorIdx = sorted.findIndex((m) => m >= startMonth);
  if (anchorIdx === -1) anchorIdx = 0;

  const result: { month: number; year: number; status: SubscriptionStatus }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const year = i >= anchorIdx ? startYear : startYear + 1;
    const subDate = year * 100 + m;
    if (subDate < startDate) continue; // تجاهل الشهور قبل بداية الطالب
    result.push({ month: m, year, status: "due" });
  }

  return result;
}

async function resolveStudentPrice(student: any, teacherId: string): Promise<{ amount: number; discount: number }> {
  let basePrice = 0;
  if (student.custom_monthly_price != null && student.custom_monthly_price > 0) {
    basePrice = student.custom_monthly_price;
  } else if (student.group_id) {
    const group = await Group.findById(student.group_id).lean();
    if (group && (group as any).monthly_price != null && (group as any).monthly_price > 0) {
      basePrice = (group as any).monthly_price;
    }
  }
  if (!basePrice) {
    const teacher = await Teacher.findById(teacherId).lean();
    basePrice = (teacher as any)?.monthly_price || 0;
  }

  const familyDiscountPct = student.family_discount_percent ?? 0;
  const individualDiscountPct = Number(student.discount_value) || 0;

  // Family discount takes priority
  const activePct = familyDiscountPct > 0 ? familyDiscountPct : individualDiscountPct;
  const netPrice = activePct > 0 ? Math.round(basePrice * (1 - activePct / 100)) : basePrice;
  const discountAmt = basePrice - netPrice;
  return { amount: basePrice, discount: discountAmt };
}

export async function generateSubscriptionsForStudent(
  studentId: string,
  teacherId: string,
  startMonth: number,
  startYear: number,
  activeMonths?: number[],
  activeMonthYears?: { month: number; year: number }[],
  session?: ClientSession
): Promise<void> {
  if (startMonth < 1 || startMonth > 12) return;

  const [student, teacher] = await series([
    Student.findById(studentId).setOptions(session ? { session } : {}).lean(),
    (activeMonths || activeMonthYears) ? Promise.resolve(null) : Teacher.findById(teacherId).lean(),
  ]);

  const teacherData = teacher ?? (activeMonths || activeMonthYears ? null : await Teacher.findById(teacherId).lean());
  const rawMonthYears: { month: number; year: number }[] | undefined =
    activeMonthYears ?? (teacherData as any)?.academic_year?.active_month_years;

  let resolved: { month: number; year: number; status: SubscriptionStatus }[];

  if (rawMonthYears && rawMonthYears.length > 0) {
    resolved = resolveMonthYearsFromPairs(rawMonthYears, startMonth, startYear);
  } else {
    const rawMonths: number[] = activeMonths ?? (teacherData as any)?.academic_year?.active_months ?? [8, 9, 10, 11, 12, 1, 2, 3, 4, 5];
    const months = rawMonths.filter((m) => m >= 1 && m <= 12);
    resolved = resolveMonthYears(months, startMonth, startYear);
  }

  const { amount, discount } = student ? await resolveStudentPrice(student, teacherId) : { amount: 0, discount: 0 };
  if (resolved.length === 0) return;

  // جلب كل الاشتراكات الموجودة بـ query واحد بدل N queries
  const years = [...new Set(resolved.map((r) => r.year))];
  const existingDocs = await MonthlySubscription.find({
    student_id: studentId,
    month: { $in: resolved.map((r) => r.month) },
    year: { $in: years },
  }).setOptions(session ? { session } : {}).lean().select("month year status amount");

  const existingMap = new Map(
    existingDocs.map((e) => [`${e.month}-${e.year}`, e])
  );

  const ops: object[] = [];

  for (const { month: m, year: subYear, status } of resolved) {
    const existing = existingMap.get(`${m}-${subYear}`);
    if (!existing) {
      ops.push({ updateOne: { filter: { student_id: studentId, month: m, year: subYear }, update: { $setOnInsert: { teacher_id: teacherId, status, amount, discount } }, upsert: true } });
    } else if (existing.status === "due" || existing.status === "not_due") {
      const update: Record<string, unknown> = { status };
      if (existing.amount === 0 && amount > 0) { update.amount = amount; update.discount = discount; }
      ops.push({ updateOne: { filter: { student_id: studentId, month: m, year: subYear, status: { $in: ["due", "not_due"] } }, update: { $set: update } } });
    }
  }

  if (ops.length > 0) await MonthlySubscription.bulkWrite(ops as any[], { ordered: true, ...(session ? { session } : {}) });
}

export async function syncNewMonthForAllStudents(
  teacherId: string,
  newMonth: number,
  newYear: number
): Promise<void> {
  const students = await Student.find({ teacher_id: teacherId }).lean().select("_id");
  if (students.length === 0) return;

  const allIds = students.map((s) => s._id);

  // جلب الاشتراكات الموجودة بـ query واحد
  const existingIds = await MonthlySubscription.find({
    student_id: { $in: allIds },
    month: newMonth,
    year: newYear,
  }).lean().select("student_id").then((docs) => new Set(docs.map((d) => String(d.student_id))));

  const newIds = allIds.filter((id) => !existingIds.has(String(id)));
  if (newIds.length === 0) return;

  // Fetch all needed data in 3 queries instead of N queries inside resolveStudentPrice.
  const eligibleStudents = await Student.find({ _id: { $in: newIds }, teacher_id: teacherId }).lean();
  const groupIds = [...new Set(eligibleStudents.map((s: any) => s.group_id).filter(Boolean).map(String))];
  const [groups, teacher] = await Promise.all([
    groupIds.length ? Group.find({ _id: { $in: groupIds } }).lean().select("_id monthly_price") : Promise.resolve([]),
    Teacher.findById(teacherId).lean().select("monthly_price"),
  ]);
  const groupMap = new Map((groups as any[]).map((g: any) => [String(g._id), g.monthly_price || 0]));
  const teacherBasePrice = (teacher as any)?.monthly_price || 0;

  const ops = eligibleStudents.map((s: any) => {
    let basePrice = 0;
    if (s.custom_monthly_price != null && s.custom_monthly_price > 0) {
      basePrice = s.custom_monthly_price;
    } else if (s.group_id) {
      basePrice = groupMap.get(String(s.group_id)) || teacherBasePrice;
    } else {
      basePrice = teacherBasePrice;
    }
    const familyPct = s.family_discount_percent ?? 0;
    const individualPct = Number(s.discount_value) || 0;
    const activePct = familyPct > 0 ? familyPct : individualPct;
    const discount = activePct > 0 ? basePrice - Math.round(basePrice * (1 - activePct / 100)) : 0;
    return {
      insertOne: {
        document: {
          student_id: s._id,
          teacher_id: teacherId,
          month: newMonth,
          year: newYear,
          status: "due",
          amount: basePrice,
          discount,
        },
      },
    };
  });

  if (ops.length > 0) await MonthlySubscription.bulkWrite(ops as any[], { ordered: false });
}

export async function syncAllStudentsForTeacher(teacherId: string): Promise<number> {
  const teacher = await Teacher.findById(teacherId).lean();
  const activeMonthYears: { month: number; year: number }[] = (teacher as any)?.academic_year?.active_month_years ?? [];
  const activeMonths: number[] = (teacher as any)?.academic_year?.active_months ?? [8, 9, 10, 11, 12, 1, 2, 3, 4, 5];

  const students = await Student.find({ teacher_id: teacherId }).lean()
    .select("_id subscription_start_month subscription_start_year group_id custom_monthly_price discount_value family_discount_percent");

  if (students.length === 0) return 0;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // ── 1. بناء validMonthYears ──────────────────────────────────────────────
  let validMonthYears: Set<string>;
  if (activeMonthYears.length > 0) {
    validMonthYears = new Set(activeMonthYears.map(({ month, year }) => `${month}-${year}`));
  } else {
    const academicStartYear = currentMonth >= 7 ? currentYear : currentYear - 1;
    validMonthYears = new Set(
      activeMonths.map((m) => {
        const y = m >= 7 ? academicStartYear : academicStartYear + 1;
        return `${m}-${y}`;
      })
    );
  }

  // ── 2. حذف الاشتراكات غير المدفوعة للشهور خارج validMonthYears ──────────
  const allExistingSubs = await MonthlySubscription.find({
    teacher_id: teacherId,
    status: { $in: ["due", "not_due"] },
  }).lean().select("_id month year");

  const toDeleteIds = allExistingSubs
    .filter((s) => !validMonthYears.has(`${s.month}-${s.year}`))
    .map((s) => s._id);

  if (toDeleteIds.length > 0) {
    await MonthlySubscription.deleteMany({ _id: { $in: toDeleteIds } });
  }

  // ── 3. جلب Groups و Teacher price مرة واحدة ─────────────────────────────
  const groupIds = [...new Set(
    students.map((s: any) => s.group_id).filter(Boolean).map(String)
  )];
  const [groups] = await Promise.all([
    groupIds.length
      ? Group.find({ _id: { $in: groupIds } }).lean().select("_id monthly_price")
      : Promise.resolve([]),
  ]);
  const groupMap = new Map((groups as any[]).map((g: any) => [String(g._id), g.monthly_price || 0]));
  const teacherBasePrice = (teacher as any)?.monthly_price || 0;

  // ── 4. بناء resolved months لكل طالب وحساب السعر بدون DB queries ────────
  const studentIds = students.map((s: any) => String(s._id));

  // جلب كل الاشتراكات الموجودة بـ query واحد (بما فيهم المدفوعة)
  const existingSubsRaw = await MonthlySubscription.find({
    teacher_id: teacherId,
    student_id: { $in: studentIds },
  }).lean().select("student_id month year status amount");

  // تجميع الاشتراكات الموجودة per student
  const existingByStudent = new Map<string, Map<string, { status: string; amount: number }>>();
  for (const sub of existingSubsRaw) {
    const sid = String(sub.student_id);
    if (!existingByStudent.has(sid)) existingByStudent.set(sid, new Map());
    existingByStudent.get(sid)!.set(`${sub.month}-${sub.year}`, { status: sub.status as string, amount: sub.amount });
  }

  // ── 5. بناء كل الـ ops في حلقة واحدة ────────────────────────────────────
  const ops: object[] = [];

  for (const s of students as any[]) {
    const sid = String(s._id);
    const startMonth = Number(s.subscription_start_month) || 8;
    const startYear = Number(s.subscription_start_year) || currentYear;
    const startDate = startYear * 100 + startMonth;

    // حساب السعر بدون DB
    let basePrice = 0;
    if (s.custom_monthly_price != null && s.custom_monthly_price > 0) {
      basePrice = s.custom_monthly_price;
    } else if (s.group_id) {
      basePrice = groupMap.get(String(s.group_id)) || teacherBasePrice;
    } else {
      basePrice = teacherBasePrice;
    }
    const familyPct = s.family_discount_percent ?? 0;
    const individualPct = Number(s.discount_value) || 0;
    const activePct = familyPct > 0 ? familyPct : individualPct;
    const netPrice = activePct > 0 ? Math.round(basePrice * (1 - activePct / 100)) : basePrice;
    const discount = basePrice - netPrice;

    // تحديد الشهور الصحيحة لهذا الطالب
    let resolved: { month: number; year: number }[];
    if (activeMonthYears.length > 0) {
      resolved = activeMonthYears.filter(({ month, year }) => year * 100 + month >= startDate);
    } else {
      const academicStartYear = currentMonth >= 7 ? currentYear : currentYear - 1;
      resolved = activeMonths
        .map((m) => ({ month: m, year: m >= 7 ? academicStartYear : academicStartYear + 1 }))
        .filter(({ month, year }) => year * 100 + month >= startDate);
    }

    const studentExisting = existingByStudent.get(sid) ?? new Map();

    for (const { month: m, year: y } of resolved) {
      const key = `${m}-${y}`;
      const existing = studentExisting.get(key);
      if (!existing) {
        ops.push({ insertOne: { document: { student_id: sid, teacher_id: teacherId, month: m, year: y, status: "due", amount: basePrice, discount } } });
      } else if ((existing.status === "due" || existing.status === "not_due") && existing.amount === 0 && basePrice > 0) {
        ops.push({ updateOne: { filter: { student_id: sid, month: m, year: y }, update: { $set: { amount: basePrice, discount } } } });
      }
    }
  }

  // ── 6. bulkWrite واحد لكل الطلاب ─────────────────────────────────────────
  if (ops.length > 0) {
    await MonthlySubscription.bulkWrite(ops as any[], { ordered: false });
  }

  return students.length;
}
