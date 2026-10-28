import { SystemSettings } from "../models/SystemSettings";

export const DEFAULT_GRACE_PERIOD_DAYS = 10;

export const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export function getArabicMonthName(month: number): string {
  return ARABIC_MONTHS[month - 1] || `شهر ${month}`;
}

export function formatMonthYearLabel(month: number, year: number): string {
  return `${getArabicMonthName(month)} ${year}`;
}

export function getPreviousMonth(month: number, year: number): { month: number; year: number } {
  if (month === 1) return { month: 12, year: year - 1 };
  return { month: month - 1, year };
}

export function getNextMonth(month: number, year: number): { month: number; year: number } {
  if (month === 12) return { month: 1, year: year + 1 };
  return { month: month + 1, year };
}

/**
 * استخراج أجزاء التاريخ في المنطقة الزمنية المعتمدة في النظام (الافتراضي: Africa/Cairo).
 * يضمن ثبات المقارنة اليومية والتحويلات بغض النظر عن توقيت السيرفر أو المتصفح.
 */
export function getDatePartsInTimezone(date: Date = new Date(), timezone = "Africa/Cairo") {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    return {
      year: get("year"),
      month: get("month"), // 1-12
      day: get("day"),     // 1-31
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
}

/**
 * جلب عدد أيام فترة السماح المعتمدة:
 * 1. إعدادات المدرس إن وُجدت
 * 2. إعدادات النظام العامة
 * 3. القيمة الافتراضية 10 أيام
 */
export async function resolveGracePeriodDays(teacher?: any): Promise<number> {
  const teacherDays = teacher?.settings?.payment_grace_period_days;
  if (typeof teacherDays === "number" && !isNaN(teacherDays) && teacherDays >= 0) {
    return teacherDays;
  }
  try {
    if (SystemSettings.db?.readyState === 1) {
      const sys = await SystemSettings.findOne().lean();
      if (sys && typeof sys.payment_grace_period_days === "number" && !isNaN(sys.payment_grace_period_days)) {
        return sys.payment_grace_period_days;
      }
    }
  } catch {
    // fallback if DB error
  }
  return DEFAULT_GRACE_PERIOD_DAYS;
}

export type PaymentScanStatus =
  | "regular_auto"
  | "grace_period_auto"
  | "grace_period_expired"
  | "arrears_require_confirmation"
  | "already_paid"
  | "no_due"
  | "suspended"
  | "invalid_amount"
  | "review_required";

export interface PaymentEvaluationResult {
  status: PaymentScanStatus;
  action: "auto_pay" | "require_confirmation" | "none";
  eligibleForAuto: boolean;
  payPeriod: { month: number; year: number };
  targetPeriod: { month: number; year: number };
  isGracePeriod: boolean;
  gracePeriodDays: number;
  arrears: { month: number; year: number }[];
  message: string;
}

export interface EvaluatePaymentScanOptions {
  student: any;
  subscriptions: any[];
  targetMonth?: number;
  targetYear?: number;
  currentDate?: Date;
  timezone?: string;
  gracePeriodDays?: number;
}

/**
 * المنطق المركزي لتقييم مدفوعات سكان الطالب:
 * - التحقق من الشهور المستحقة والأشهر السابقة غير المدفوعة
 * - تحديد ما إذا كان الطالب داخل فترة السماح أو تجاوزها
 * - تحديد إمكانية الدفع التلقائي أو اشتراط تأكيد المدرس
 */
export function evaluatePaymentScan({
  student,
  subscriptions,
  targetMonth,
  targetYear,
  currentDate = new Date(),
  timezone = "Africa/Cairo",
  gracePeriodDays = DEFAULT_GRACE_PERIOD_DAYS,
}: EvaluatePaymentScanOptions): PaymentEvaluationResult {
  const nowParts = getDatePartsInTimezone(currentDate, timezone);
  const currentMonth = nowParts.month;
  const currentYear = nowParts.year;
  const currentDay = nowParts.day;

  const validTargetMonth =
    targetMonth && Number.isInteger(targetMonth) && targetMonth >= 1 && targetMonth <= 12
      ? targetMonth
      : currentMonth;
  const validTargetYear =
    targetYear && Number.isInteger(targetYear) && targetYear >= 2000 && targetYear <= 2100
      ? targetYear
      : currentYear;

  const targetPeriod = { month: validTargetMonth, year: validTargetYear };

  // الطالب موقوف: لا دفع تلقائي ويجب تأكيد المدرس ومراجعة السبب
  if (student?.is_suspended) {
    const dueSubs = subscriptions
      .filter((s) => s.status === "due")
      .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
    const payPeriod = dueSubs[0]
      ? { month: dueSubs[0].month, year: dueSubs[0].year }
      : targetPeriod;
    return {
      status: "suspended",
      action: "require_confirmation",
      eligibleForAuto: false,
      payPeriod,
      targetPeriod,
      isGracePeriod: false,
      gracePeriodDays,
      arrears: dueSubs.map((s) => ({ month: s.month, year: s.year })),
      message: "الطالب موقوف — راجع سبب الإيقاف قبل تأكيد استلام الدفع.",
    };
  }

  // الاشتراكات المستحقة (غير المدفوعة) مرتبة زمنياً من الأقدم للأحدث
  const dueSubs = subscriptions
    .filter((s) => s.status === "due")
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));

  // لا توجد أي اشتراكات مستحقة حالياً
  if (dueSubs.length === 0) {
    const targetSub = subscriptions.find(
      (s) => s.month === targetPeriod.month && s.year === targetPeriod.year
    );
    if (targetSub && (targetSub.status === "paid" || targetSub.status === "exempt")) {
      return {
        status: "already_paid",
        action: "none",
        eligibleForAuto: false,
        payPeriod: targetPeriod,
        targetPeriod,
        isGracePeriod: false,
        gracePeriodDays,
        arrears: [],
        message: `اشتراك شهر ${getArabicMonthName(targetPeriod.month)} مدفوع بالفعل، ولا يمكن تسجيل الدفع مرة أخرى.`,
      };
    }
    return {
      status: "no_due",
      action: "none",
      eligibleForAuto: false,
      payPeriod: targetPeriod,
      targetPeriod,
      isGracePeriod: false,
      gracePeriodDays,
      arrears: [],
      message: `لا توجد اشتراكات مستحقة على الطالب ${student?.name || ""}.`,
    };
  }

  const oldestDue = dueSubs[0];
  const prev = getPreviousMonth(currentMonth, currentYear);

  const oldestDiscount = Number.isFinite(oldestDue.discount) ? oldestDue.discount : (oldestDue.discount == null ? 0 : NaN);
  const oldestAmount = Number.isFinite(oldestDue.amount) ? oldestDue.amount : (oldestDue.amount == null ? 0 : NaN);
  const isOldestAmountValid =
    Number.isFinite(oldestAmount) &&
    Number.isFinite(oldestDiscount) &&
    oldestAmount > oldestDiscount &&
    oldestDiscount >= 0 &&
    oldestAmount > 0;

  const isPreviousMonth = oldestDue.month === prev.month && oldestDue.year === prev.year;
  const oldestDueNum = oldestDue.year * 100 + oldestDue.month;
  const targetNum = targetPeriod.year * 100 + targetPeriod.month;

  if (isPreviousMonth) {
    // قاعدة فترة السماح: تمتد حتى اليوم المحدد (افتراضياً 10) من الشهر التالي شاملاً
    if (currentDay <= gracePeriodDays) {
      if (isOldestAmountValid) {
        return {
          status: "grace_period_auto",
          action: "auto_pay",
          eligibleForAuto: true,
          payPeriod: { month: oldestDue.month, year: oldestDue.year },
          targetPeriod,
          isGracePeriod: true,
          gracePeriodDays,
          arrears: [],
          message: `تم تسجيل دفع شهر ${getArabicMonthName(oldestDue.month)} بنجاح خلال فترة السماح.`,
        };
      }
    } else {
      // الحالة الرابعة أو الثالثة بعد انتهاء فترة السماح
      if (targetNum > oldestDueNum) {
        // الحالة الثالثة: المدرس يحاول دفع شهر أحدث (مثلاً أكتوبر) مع وجود متأخرات عن سبتمبر
        return {
          status: "arrears_require_confirmation",
          action: "require_confirmation",
          eligibleForAuto: false,
          payPeriod: targetPeriod,
          targetPeriod,
          isGracePeriod: false,
          gracePeriodDays,
          arrears: [{ month: oldestDue.month, year: oldestDue.year }],
          message: `الطالب عليه متأخرات عن شهر ${getArabicMonthName(oldestDue.month)}. هل تريد المتابعة وتسجيل الدفع عن شهر ${getArabicMonthName(targetPeriod.month)}؟`,
        };
      } else {
        // الحالة الرابعة: تجاوز فترة السماح للشهر السابق ويراد سداد الشهر السابق نفسه
        return {
          status: "grace_period_expired",
          action: "require_confirmation",
          eligibleForAuto: false,
          payPeriod: { month: oldestDue.month, year: oldestDue.year },
          targetPeriod,
          isGracePeriod: false,
          gracePeriodDays,
          arrears: [{ month: oldestDue.month, year: oldestDue.year }],
          message: `الطالب لم يسدد اشتراك شهر ${getArabicMonthName(oldestDue.month)} خلال فترة السماح. هل تريد تسجيل الدفع عن شهر ${getArabicMonthName(oldestDue.month)} الآن؟`,
        };
      }
    }
  }

  // الحالة الأولى: الطالب منتظم ولا توجد عليه متأخرات (يسدد الشهر الحالي في حينه)
  const isCurrentMonth =
    oldestDue.month === currentMonth && oldestDue.year === currentYear;
  const isTargetingCurrent =
    targetPeriod.month === currentMonth && targetPeriod.year === currentYear;

  if (isCurrentMonth && isTargetingCurrent && isOldestAmountValid) {
    return {
      status: "regular_auto",
      action: "auto_pay",
      eligibleForAuto: true,
      payPeriod: { month: oldestDue.month, year: oldestDue.year },
      targetPeriod,
      isGracePeriod: false,
      gracePeriodDays,
      arrears: [],
      message: `تم تسجيل دفع شهر ${getArabicMonthName(oldestDue.month)} بنجاح.`,
    };
  }

  // الحالة الثالثة: الطالب عليه متأخرات أقدم
  // مثال: أغسطس مدفوع، سبتمبر غير مدفوع، والمدرس يحاول تحصيل أكتوبر أو توجد شهور أقدم
  const arrears = dueSubs.filter((s) => s.year * 100 + s.month < targetNum);

  if (arrears.length > 0) {
    const arrearsNames = arrears
      .map((a) =>
        a.year === targetPeriod.year
          ? getArabicMonthName(a.month)
          : `${getArabicMonthName(a.month)} ${a.year}`
      )
      .join("، ");

    return {
      status: "arrears_require_confirmation",
      action: "require_confirmation",
      eligibleForAuto: false,
      payPeriod: targetPeriod,
      targetPeriod,
      isGracePeriod: false,
      gracePeriodDays,
      arrears: arrears.map((a) => ({ month: a.month, year: a.year })),
      message: `الطالب عليه متأخرات عن شهر ${arrearsNames}. هل تريد المتابعة وتسجيل الدفع عن شهر ${getArabicMonthName(targetPeriod.month)}؟`,
    };
  }

  // إذا كانت المبالغ غير صالحة أو هناك حالة أخرى تستدعي المراجعة
  return {
    status: isOldestAmountValid ? "review_required" : "invalid_amount",
    action: "require_confirmation",
    eligibleForAuto: false,
    payPeriod: { month: oldestDue.month, year: oldestDue.year },
    targetPeriod,
    isGracePeriod: false,
    gracePeriodDays,
    arrears: dueSubs.map((s) => ({ month: s.month, year: s.year })),
    message: isOldestAmountValid
      ? "راجع مستحقات الطالب والشهور، ثم أكد استلام الدفع."
      : "مبالغ الاشتراك تحتاج إلى مراجعة وتعديل قبل الدفع.",
  };
}
