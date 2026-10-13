import { generateSubscriptionsForStudent, syncAllStudentsForTeacher } from "../services/subscriptionLifecycle";
export { generateSubscriptionsForStudent, syncNewMonthForAllStudents, syncAllStudentsForTeacher } from "../services/subscriptionLifecycle";
import { Response } from "express";
import { MonthlySubscription, SubscriptionStatus } from "../models/MonthlySubscription";
import { Student } from "../models/Student";
import { Teacher } from "../models/Teacher";
import { Group } from "../models/Group";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { invalidateDashboardCache } from "./dashboardController";

// استخدم teacherFilter المركزي لضمان توحيد Authorization عبر teacher/admin/center/staff
function subTeacherFilter(req: AuthRequest): Record<string, unknown> {
  return teacherFilter(req);
}

// Given a list of {month, year} pairs and a start date, return only months >= start


// Legacy: Given a sorted list of active months and a start (month, year),
// assign each active month the correct calendar year — only months >= start.


// Helper: resolve monthly price for a student (after family discount)


// Helper: generate subscriptions for a student based on teacher's academic year


// Sync a newly added month to all existing students of a teacher


export const getStudentSubscriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const student = await Student.findOne({ _id: studentId, ...subTeacherFilter(req) }).lean();
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
  const subs = await MonthlySubscription.find({ student_id: studentId }).sort({ year: 1, month: 1 });
  res.json(subs);
};

// Batch: جلب subscriptions لمجموعة طلاب في request واحد
// محدود بالسنة الأكاديمية الحالية والسابقة مباشرة فقط
export const getBatchSubscriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  const raw = req.query.studentIds as string;
  if (!raw) { res.status(400).json({ message: "studentIds مطلوب" }); return; }
  const studentIds = raw.split(",").filter(Boolean);
  if (studentIds.length === 0) { res.json({}); return; }

  // تحديد نطاق السنة الأكاديمية: الحالية + السابقة مباشرة
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // السنة الأكاديمية تبدأ من يوليو — نجلب السنة الحالية والسابقة فقط
  const academicStartYear = currentMonth >= 7 ? currentYear : currentYear - 1;
  const validYears = [academicStartYear, academicStartYear + 1];

  const subs = await MonthlySubscription.find({
    ...subTeacherFilter(req),
    student_id: { $in: studentIds },
    year: { $in: validYears },
  }).sort({ year: 1, month: 1 }).lean()
    .select("student_id month year status amount discount paid_at");

  const grouped: Record<string, unknown[]> = {};
  for (const s of subs) {
    const key = String(s.student_id);
    if (!grouped[key]) grouped[key] = [];
    const { _id, __v, ...rest } = s as any;
    grouped[key].push({ id: String(_id), ...rest });
  }
  res.json(grouped);
};

export const getAllTeacherSubscriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  const query: Record<string, unknown> = { ...subTeacherFilter(req) };
  if (req.query.month) query.month = Number(req.query.month);
  if (req.query.year)  query.year  = Number(req.query.year);
  const subs = await MonthlySubscription.find(query)
    .sort({ year: 1, month: 1 })
    .lean()
    .select("student_id teacher_id month year status amount discount paid_at");
  res.json(subs.map(({ _id, __v, student_id, teacher_id, ...rest }: any) => ({
    id: String(_id),
    student_id: String(student_id),
    teacher_id: String(teacher_id),
    ...rest,
  })));
};

// Auto-unsuspend: لو المتأخرات نزلت تحت الـ threshold يُفك الإيقاف تلقائياً
async function checkAndAutoUnsuspend(studentId: string, teacherId: string, threshold = 3): Promise<void> {
  const student = await Student.findOne({ _id: studentId, teacher_id: teacherId, is_suspended: true }).lean();
  if (!student) return;

  const now = new Date();
  const nowDate = now.getFullYear() * 100 + (now.getMonth() + 1);

  const dueSubs = await MonthlySubscription.find({
    student_id: studentId,
    status: "due",
  }).lean().select("month year");

  const overdueCount = dueSubs.filter((s) => s.year * 100 + s.month < nowDate).length;

  if (overdueCount < threshold) {
    await Student.findByIdAndUpdate(studentId, {
      is_suspended: false,
      suspended_until: null,
      suspension_reason: null,
    });
  }
}

export const updateSubscription = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  // SECURITY: amount and discount are server-calculated from the student's price
  // and discount rules. They must NOT be accepted directly from the client here
  // to prevent financial manipulation.
  // Only safe, non-financial fields are whitelisted below.
  // To correct a subscription's price use the dedicated fixSubscriptionAmounts endpoint.
  const updates: Record<string, unknown> = {};

  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.paid_at !== undefined) updates.paid_at = req.body.paid_at;
  if (req.body.receipt_number !== undefined) updates.receipt_number = req.body.receipt_number;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;

  // Derive paid_at from status transitions rather than trusting the client value
  if (updates.status === "paid" && !updates.paid_at) updates.paid_at = new Date();
  if (updates.status !== undefined && updates.status !== "paid") updates.paid_at = null;

  // Validate status enum
  const VALID_STATUSES = new Set(["not_due", "due", "paid", "exempt"]);
  if (updates.status !== undefined && !VALID_STATUSES.has(updates.status as string)) {
    res.status(400).json({ message: "حالة الاشتراك غير صالحة" }); return;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "لا توجد حقول للتحديث" }); return;
  }

  const sub = await MonthlySubscription.findOneAndUpdate(
    { _id: id, ...subTeacherFilter(req) },
    { $set: updates },
    { new: true }
  );
  if (!sub) { res.status(404).json({ message: "الاشتراك غير موجود" }); return; }

  if (updates.status === "paid" || updates.status === "exempt") {
    await checkAndAutoUnsuspend(String(sub.student_id), String(sub.teacher_id));
  }

  invalidateDashboardCache(String(sub.teacher_id));
  res.json(sub);
};

export const bulkUpdateSubscriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { updates } = req.body as { updates: { id: string; status: SubscriptionStatus }[] };

  if (!Array.isArray(updates) || updates.length === 0) {
    res.json([]);
    return;
  }

  const now = new Date();
  const filter = subTeacherFilter(req);

  // Build a single bulkWrite instead of N concurrent findOneAndUpdate calls.
  // This reduces N round-trips to 1 while preserving all authorization checks
  // (teacher_id filter is embedded in each updateOne filter).
  const ops = updates.map(({ id, status }) => {
    const extra: Record<string, unknown> = {};
    if (status === "paid") extra.paid_at = now;
    else extra.paid_at = null;
    return {
      updateOne: {
        filter: { _id: id, student_id: studentId, ...filter } as Record<string, unknown>,
        update: { $set: { status, ...extra } },
      },
    };
  });

  await MonthlySubscription.bulkWrite(ops as any[], { ordered: false });

  // Fetch updated docs to return to the client (same shape as before)
  const ids = updates.map((u) => u.id);
  const results = await MonthlySubscription.find({ _id: { $in: ids }, ...filter }).lean();

  const hasPaidOrExempt = updates.some((u) => u.status === "paid" || u.status === "exempt");
  if (hasPaidOrExempt) {
    const anyResult = results[0] as any;
    const tid = anyResult ? String(anyResult.teacher_id) : req.user!.id;
    await checkAndAutoUnsuspend(studentId, tid);
  }

  invalidateDashboardCache(req.user!.id);
  res.json(results);
};

export const regenerateSubscriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const student = await Student.findOne({ _id: studentId, ...subTeacherFilter(req) }).lean();
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

  const now = new Date();
  const startMonth = Number((student as any).subscription_start_month) || (now.getMonth() + 1);
  const startYear = Number((student as any).subscription_start_year) || now.getFullYear();

  const teacherId = String((student as any).teacher_id);
  await generateSubscriptionsForStudent(studentId, teacherId, startMonth, startYear);

  const subs = await MonthlySubscription.find({ student_id: studentId }).sort({ year: 1, month: 1 });
  res.json(subs);
};

// Fix all due subscriptions amounts for the current teacher
export const autoSuspendStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const threshold = Number(req.query.months) || 3;
  const now = new Date();
  const nowDate = now.getFullYear() * 100 + (now.getMonth() + 1);

  // جلب كل الاشتراكات المتأخرة (due) حتى الشهر الحالي
  const dueSubs = await MonthlySubscription.find({
    teacher_id: teacherId,
    status: "due",
  }).lean().select("student_id month year");

  // تجميع عدد المتأخرات لكل طالب (فقط الشهور اللي فاتت)
  const dueCountMap = new Map<string, number>();
  for (const sub of dueSubs) {
    const subDate = sub.year * 100 + sub.month;
    if (subDate >= nowDate) continue; // شهر حالي أو مستقبلي — تجاهل
    const key = String(sub.student_id);
    dueCountMap.set(key, (dueCountMap.get(key) ?? 0) + 1);
  }

  // الطلاب اللي عندهم >= threshold متأخرات وغير موقوفين
  const eligibleIds = [...dueCountMap.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([id]) => id);

  if (eligibleIds.length === 0) { res.json({ suspended: 0, students: [] }); return; }

  const students = await Student.find({
    _id: { $in: eligibleIds },
    teacher_id: teacherId,
    is_suspended: { $ne: true },
  }).lean().select("_id name");

  if (students.length === 0) { res.json({ suspended: 0, students: [] }); return; }

  const reason = `متأخرات لم تسدد (${threshold} شهور أو أكثر)`;
  await Student.updateMany(
    { _id: { $in: students.map(s => s._id) }, teacher_id: teacherId },
    { is_suspended: true, suspended_until: null, suspension_reason: reason }
  );

  res.json({
    suspended: students.length,
    students: students.map(s => ({ id: String(s._id), name: (s as any).name })),
  });
};

// Sync all students of a teacher with the current active_months (shared helper + endpoint)


export const syncAllStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const synced = await syncAllStudentsForTeacher(teacherId);
  res.json({ synced });
};

// إصلاح بيانات rollover خاطئة: مسح الشهور المستقبلية من active_month_years وحذف اشتراكاتها
export const fixRolloverData = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const teacher = await Teacher.findById(teacherId).lean();
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  // السنة الأكاديمية الحالية: تبدأ من يوليو
  const academicStartYear = currentMonth >= 7 ? currentYear : currentYear - 1;
  const academicEndYear = academicStartYear + 1;
  // الشهور الصحيحة للسنة الأكاديمية الحالية
  const validMonthYears: { month: number; year: number }[] = [];
  for (let m = 7; m <= 12; m++) validMonthYears.push({ month: m, year: academicStartYear });
  for (let m = 1; m <= 6; m++) validMonthYears.push({ month: m, year: academicEndYear });

  const current: { month: number; year: number }[] =
    (teacher as any)?.academic_year?.active_month_years ?? [];

  // فلترة الشهور: نبقي بس الشهور اللي في السنة الأكاديمية الحالية
  const validSet = new Set(validMonthYears.map((x) => `${x.month}-${x.year}`));
  const fixed = current.filter((x) => validSet.has(`${x.month}-${x.year}`));
  const removedYears = [...new Set(current.filter((x) => !validSet.has(`${x.month}-${x.year}`)).map((x) => x.year))];

  await Teacher.findByIdAndUpdate(teacherId, {
    "academic_year.active_month_years": fixed,
    "academic_year.active_months": fixed.map((x) => x.month),
  });

  // حذف اشتراكات السنوات الخاطئة غير المدفوعة
  let deletedCount = 0;
  if (removedYears.length > 0) {
    const result = await MonthlySubscription.deleteMany({
      teacher_id: teacherId,
      year: { $in: removedYears },
      status: { $in: ["due", "not_due"] },
    });
    deletedCount = result.deletedCount;
  }

  res.json({ fixed: fixed.length, removedYears, deletedSubscriptions: deletedCount });
};

// تجديد السنة الأكاديمية: مسح سنة قديمة من active_month_years وإضافة سنة جديدة
export const rolloverAcademicYear = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const teacher = await Teacher.findById(teacherId).lean();
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }

  const current: { month: number; year: number }[] =
    (teacher as any)?.academic_year?.active_month_years ?? [];
  if (current.length === 0) { res.status(400).json({ message: "لا توجد أشهر محددة" }); return; }

  const years = [...new Set(current.map((x) => x.year))].sort();
  const oldestYear = years[0];
  const newestYear = years[years.length - 1];
  const newYear = newestYear + 1;

  // الشهور اللي هتتمسح (أقدم سنة)
  const toRemove = current.filter((x) => x.year === oldestYear);
  // الشهور اللي هتتضاف (نفس الشهور بس بسنة جديدة)
  const toAdd = toRemove.map((x) => ({ month: x.month, year: newYear }));

  const updated = [
    ...current.filter((x) => x.year !== oldestYear),
    ...toAdd,
  ];

  await Teacher.findByIdAndUpdate(teacherId, {
    "academic_year.active_month_years": updated,
    "academic_year.active_months": updated.map((x) => x.month),
  });

  // مسح اشتراكات السنة القديمة غير المدفوعة
  await MonthlySubscription.deleteMany({
    teacher_id: teacherId,
    year: oldestYear,
    status: { $in: ["due", "not_due"] },
  });

  // مزامنة الطلاب مع الشهور الجديدة
  const synced = await syncAllStudentsForTeacher(teacherId);

  res.json({ oldestYear, newYear, synced, active_month_years: updated });
};

export const fixSubscriptionAmounts = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.id;
  const students = await Student.find({ teacher_id: teacherId }).lean();
  let fixed = 0;

  // جلب كل الـ groups والـ teacher مرة واحدة بدل N queries
  const groupIds = [...new Set(students.map((s) => (s as any).group_id).filter((id) => id && id !== "null"))].map(String);
  const [groups, teacher] = await Promise.all([
    Group.find({ _id: { $in: groupIds } }).lean(),
    Teacher.findById(teacherId).lean(),
  ]);
  const groupMap = new Map(groups.map((g) => [String(g._id), g]));
  const teacherBasePrice = (teacher as any)?.monthly_price || 0;

  for (const student of students) {
    // حساب السعر الأساسي من الـ cache
    let basePrice = 0;
    if ((student as any).custom_monthly_price != null && (student as any).custom_monthly_price > 0) {
      basePrice = (student as any).custom_monthly_price;
    } else if ((student as any).group_id) {
      const g = groupMap.get(String((student as any).group_id)) as any;
      if (g?.monthly_price != null && g.monthly_price > 0) basePrice = g.monthly_price;
    }
    if (!basePrice) basePrice = teacherBasePrice;
    if (basePrice === 0) continue;

    const familyDiscountPct = (student as any).family_discount_percent ?? 0;
    const individualDiscountPct = Number((student as any).discount_value) || 0;
    const activePct = familyDiscountPct > 0 ? familyDiscountPct : individualDiscountPct;
    const netPrice = activePct > 0 ? Math.round(basePrice * (1 - activePct / 100)) : basePrice;
    const discountAmt = basePrice - netPrice;

    // تحديث الاشتراكات المستحقة فقط (due) — لا نمس المدفوعة
    const result = await MonthlySubscription.updateMany(
      { student_id: student._id, teacher_id: teacherId, status: "due" },
      { $set: { amount: basePrice, discount: discountAmt } }
    );
    fixed += result.modifiedCount;
  }

  res.json({ message: `تم تصحيح ${fixed} اشتراك`, fixed });
};

/**
 * GET /subscriptions/summary
 * Returns a compact per-student summary sufficient for:
 *   - isStudentPaid (month/year)
 *   - getArrears (count of overdue "due" subs)
 *   - getLastPaidMonth (latest paid/exempt sub date)
 *   - hasAllSubsPaid (due count < 2 check)
 * Much smaller payload than GET /subscriptions.
 */
export const getSubscriptionsSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = subTeacherFilter(req);
  const now = new Date();
  const nowDate = now.getFullYear() * 100 + (now.getMonth() + 1);

  // Cast string teacher_id(s) to ObjectId — Mongoose auto-casts in .find() but NOT in aggregate $match
  const { Types } = await import("mongoose");
  const castFilter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === "teacher_id") {
      if (typeof v === "string") {
        castFilter[k] = new Types.ObjectId(v);
      } else if (v && typeof v === "object" && "$in" in (v as object)) {
        castFilter[k] = { $in: ((v as any).$in as string[]).map((id) => new Types.ObjectId(id)) };
      } else {
        castFilter[k] = v;
      }
    } else {
      castFilter[k] = v;
    }
  }

  const pipeline = [
    { $match: castFilter },
    {
      $group: {
        _id: "$student_id",
        overdueCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "due"] },
                  {
                    $lt: [
                      { $add: [{ $multiply: ["$year", 100] }, "$month"] },
                      nowDate,
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        allEntries: { $push: { month: "$month", year: "$year", status: "$status" } },
      },
    },
    {
      $project: {
        _id: 0,
        studentId: { $toString: "$_id" },
        overdueCount: 1,
        paidEntries: {
          $filter: {
            input: "$allEntries",
            as: "e",
            cond: { $in: ["$$e.status", ["paid", "exempt"]] },
          },
        },
        dueEntries: {
          $filter: {
            input: "$allEntries",
            as: "e",
            cond: { $eq: ["$$e.status", "due"] },
          },
        },
      },
    },
  ];

  const results = await MonthlySubscription.aggregate(pipeline as any[]);
  res.json(results);
};
