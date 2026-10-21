export interface StudentDiscountPolicy {family_discount_percent?: number | null; discount_value?: number | null}

/** The student's discount has no month expiry; family policy has priority. */
export function studentSubscriptionDiscount(amount: number, student: StudentDiscountPolicy): number {
  const family = Number(student.family_discount_percent) || 0;
  const individual = Number(student.discount_value) || 0;
  const percent = family > 0 ? family : individual;
  return percent > 0 ? amount - Math.round(amount * (1 - percent / 100)) : 0;
}
