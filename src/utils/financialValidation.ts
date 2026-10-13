/**
 * financialValidation.ts
 *
 * Reusable, deterministic, server-side validation helpers for all financial
 * models (Bill, Salary, BillTemplate, MonthlySubscription, BookSale).
 *
 * Each helper returns null on success or a human-readable Arabic error string
 * so controllers can do:
 *   const err = validateMoneyAmount(req.body.amount);
 *   if (err) { res.status(400).json({ message: err }); return; }
 */

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

/**
 * Validates a monetary amount.
 * - Must be a finite number
 * - Must be >= 0 (zero is valid — e.g. exempt book sale)
 * - Must be < 10,000,000 (10M EGP hard cap — prevents runaway values)
 * - No NaN, Infinity, or negative values
 */
export function validateMoneyAmount(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return "القيمة المالية يجب أن تكون رقماً صحيحاً";
  if (n < 0) return "القيمة المالية لا يمكن أن تكون سالبة";
  if (n > 10_000_000) return "القيمة المالية تتجاوز الحد المسموح به";
  return null;
}

/**
 * Validates a required monetary amount that must be > 0.
 * Use for bills/salaries where zero amount has no business meaning.
 */
export function validatePositiveAmount(value: unknown): string | null {
  const base = validateMoneyAmount(value);
  if (base) return base;
  if (Number(value) === 0) return "القيمة المالية يجب أن تكون أكبر من صفر";
  return null;
}

/**
 * Validates a discount amount against a base price.
 * - discount must pass validateMoneyAmount
 * - discount must be <= baseAmount (can't discount more than the price)
 */
export function validateDiscount(discount: unknown, baseAmount: number): string | null {
  const err = validateMoneyAmount(discount);
  if (err) return err;
  if (Number(discount) > baseAmount) {
    return `الخصم (${discount}) لا يمكن أن يتجاوز المبلغ الأصلي (${baseAmount})`;
  }
  return null;
}

/**
 * Validates a billing month (1–12).
 */
export function validateMonth(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    return "الشهر يجب أن يكون رقماً بين 1 و 12";
  }
  return null;
}

/**
 * Validates a billing year (2000–2100).
 */
export function validateYear(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < YEAR_MIN || n > YEAR_MAX) {
    return `السنة يجب أن تكون بين ${YEAR_MIN} و ${YEAR_MAX}`;
  }
  return null;
}

/**
 * Validates both month and year together.
 * Returns the first error found, or null.
 */
export function validateBillingPeriod(month: unknown, year: unknown): string | null {
  return validateMonth(month) ?? validateYear(year);
}

/**
 * Validates a month/year pair (same as validateBillingPeriod, alias for clarity).
 */
export function validateMonthYear(month: unknown, year: unknown): string | null {
  return validateBillingPeriod(month, year);
}

/**
 * Validates a discount percentage (0–100).
 */
export function validateDiscountPercent(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return "نسبة الخصم يجب أن تكون بين 0 و 100";
  }
  return null;
}
