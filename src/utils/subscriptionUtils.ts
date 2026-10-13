import { SubscriptionStatus } from "../models/MonthlySubscription";

/**
 * Given a sorted list of active months and a start (month, year),
 * assign each active month the correct calendar year.
 */
export function resolveMonthYears(
  activeMonths: number[],
  startMonth: number,
  startYear: number
): { month: number; year: number; status: SubscriptionStatus }[] {
  if (activeMonths.length === 0) return [];

  const sorted = [...activeMonths].sort((a, b) => a - b);
  const startDate = startYear * 100 + startMonth;

  // anchorIdx = first month >= startMonth
  let anchorIdx = sorted.findIndex((m) => m >= startMonth);
  if (anchorIdx === -1) anchorIdx = 0;

  // months from anchorIdx onward → startYear, months before anchorIdx → startYear+1
  // BUT: months before anchorIdx that are also < startMonth in startYear → they belong to startYear (not_due)
  // Fix: assign year based on academic wrap, then let status be determined by subDate vs startDate
  const result: { month: number; year: number; status: SubscriptionStatus }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    // Months at/after anchorIdx are in startYear (same half of academic year as startMonth)
    // Months before anchorIdx wrap to startYear+1 (next calendar year)
    const year = i >= anchorIdx ? startYear : startYear + 1;
    const subDate = year * 100 + m;
    const status: SubscriptionStatus = subDate >= startDate ? "due" : "not_due";
    result.push({ month: m, year, status });
  }

  return result;
}

/** تطبيق الخصم على السعر الأساسي */
export function applyDiscount(
  basePrice: number,
  discountPercent: number
): { amount: number; discount: number } {
  if (discountPercent <= 0 || discountPercent > 100)
    return { amount: basePrice, discount: 0 };
  const netPrice = Math.round(basePrice * (1 - discountPercent / 100));
  return { amount: basePrice, discount: basePrice - netPrice };
}

/** توليد كود الطالب بناءً على كود المجموعة والتسلسل الأعلى */
export function generateStudentCode(groupCode: string, maxSeq: number): string {
  return `${groupCode}-${String(maxSeq + 1).padStart(4, "0")}`;
}

/** تحويل وقت 24h لـ 12h عربي */
export function formatTimeTo12H(timeStr: string): string {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] || "00";
  const ampm = hours >= 12 ? "م" : "ص";
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}
