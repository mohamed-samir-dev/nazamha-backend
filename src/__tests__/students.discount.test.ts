/**
 * students.discount.test.ts
 * Pure logic tests for discount sync operations — no DB connection needed.
 */

// ─── Helpers (mirror controller logic) ───────────────────────────────────────

function validateDiscountPercent(percent: unknown): string | null {
  if (percent === null || percent === undefined) return null; // null = remove discount
  const n = Number(percent);
  if (isNaN(n) || n < 0 || n > 100) return "النسبة يجب أن تكون بين 0 و 100";
  return null;
}

function calcDiscountAmount(basePrice: number, percent: number): { amount: number; discount: number } {
  if (percent <= 0 || percent > 100) return { amount: basePrice, discount: 0 };
  const netPrice = Math.round(basePrice * (1 - percent / 100));
  return { amount: basePrice, discount: basePrice - netPrice };
}

function resolveActiveDiscount(
  familyDiscountPct: number | null | undefined,
  individualDiscountPct: number | null | undefined
): number {
  const family = familyDiscountPct ?? 0;
  const individual = Number(individualDiscountPct) || 0;
  return family > 0 ? family : individual;
}

function resolveBasePrice(
  customPrice: number | null | undefined,
  groupPrice: number | null | undefined,
  teacherPrice: number | null | undefined
): number {
  if (customPrice != null && customPrice > 0) return customPrice;
  if (groupPrice != null && groupPrice > 0) return groupPrice;
  return teacherPrice ?? 0;
}

// ─── validateDiscountPercent ──────────────────────────────────────────────────

describe("validateDiscountPercent", () => {
  test("يقبل نسبة صحيحة", () => {
    expect(validateDiscountPercent(10)).toBeNull();
    expect(validateDiscountPercent(0)).toBeNull();
    expect(validateDiscountPercent(100)).toBeNull();
  });

  test("يقبل null (إزالة الخصم)", () => {
    expect(validateDiscountPercent(null)).toBeNull();
  });

  test("يرفض نسبة سالبة", () => {
    expect(validateDiscountPercent(-1)).toBe("النسبة يجب أن تكون بين 0 و 100");
  });

  test("يرفض نسبة أكبر من 100", () => {
    expect(validateDiscountPercent(101)).toBe("النسبة يجب أن تكون بين 0 و 100");
  });

  test("يرفض NaN", () => {
    expect(validateDiscountPercent("abc")).toBe("النسبة يجب أن تكون بين 0 و 100");
  });
});

// ─── calcDiscountAmount ───────────────────────────────────────────────────────

describe("calcDiscountAmount", () => {
  test("يحسب الخصم بشكل صحيح", () => {
    expect(calcDiscountAmount(300, 10)).toEqual({ amount: 300, discount: 30 });
  });

  test("خصم 0 لا يغير السعر", () => {
    expect(calcDiscountAmount(300, 0)).toEqual({ amount: 300, discount: 0 });
  });

  test("خصم 100% يجعل الخصم = السعر كامل", () => {
    expect(calcDiscountAmount(300, 100)).toEqual({ amount: 300, discount: 300 });
  });

  test("خصم سالب لا يُطبق", () => {
    expect(calcDiscountAmount(300, -5)).toEqual({ amount: 300, discount: 0 });
  });

  test("خصم أكبر من 100 لا يُطبق", () => {
    expect(calcDiscountAmount(300, 150)).toEqual({ amount: 300, discount: 0 });
  });

  test("يقرب للأقرب صحيح — 300 * 33% = 99", () => {
    expect(calcDiscountAmount(300, 33)).toEqual({ amount: 300, discount: 99 });
  });
});

// ─── resolveActiveDiscount ────────────────────────────────────────────────────

describe("resolveActiveDiscount", () => {
  test("الخصم العائلي يطغى على الفردي", () => {
    expect(resolveActiveDiscount(20, 10)).toBe(20);
  });

  test("يستخدم الفردي لو مفيش عائلي", () => {
    expect(resolveActiveDiscount(0, 10)).toBe(10);
  });

  test("يستخدم الفردي لو العائلي null", () => {
    expect(resolveActiveDiscount(null, 15)).toBe(15);
  });

  test("يرجع 0 لو مفيش خصم", () => {
    expect(resolveActiveDiscount(0, 0)).toBe(0);
    expect(resolveActiveDiscount(null, null)).toBe(0);
  });

  test("يتجاهل العائلي لو 0 ويستخدم الفردي", () => {
    expect(resolveActiveDiscount(0, 25)).toBe(25);
  });
});

// ─── resolveBasePrice ─────────────────────────────────────────────────────────

describe("resolveBasePrice", () => {
  test("custom_monthly_price له الأولوية", () => {
    expect(resolveBasePrice(400, 300, 200)).toBe(400);
  });

  test("group price لو مفيش custom", () => {
    expect(resolveBasePrice(null, 300, 200)).toBe(300);
  });

  test("teacher price لو مفيش custom ولا group", () => {
    expect(resolveBasePrice(null, null, 200)).toBe(200);
  });

  test("يرجع 0 لو مفيش أي سعر", () => {
    expect(resolveBasePrice(null, null, null)).toBe(0);
  });

  test("يتجاهل custom لو 0 ويستخدم group", () => {
    expect(resolveBasePrice(0, 300, 200)).toBe(300);
  });

  test("يتجاهل group لو 0 ويستخدم teacher", () => {
    expect(resolveBasePrice(null, 0, 200)).toBe(200);
  });
});

// ─── integration: full discount calculation ───────────────────────────────────

describe("full discount calculation flow", () => {
  test("طالب بخصم عائلي 20% وسعر مجموعة 300", () => {
    const base = resolveBasePrice(null, 300, 250);
    const pct = resolveActiveDiscount(20, 10);
    const result = calcDiscountAmount(base, pct);
    expect(result).toEqual({ amount: 300, discount: 60 });
  });

  test("طالب بخصم فردي 10% وسعر مخصص 400", () => {
    const base = resolveBasePrice(400, 300, 250);
    const pct = resolveActiveDiscount(0, 10);
    const result = calcDiscountAmount(base, pct);
    expect(result).toEqual({ amount: 400, discount: 40 });
  });

  test("طالب بدون أي خصم", () => {
    const base = resolveBasePrice(null, 300, 250);
    const pct = resolveActiveDiscount(0, 0);
    const result = calcDiscountAmount(base, pct);
    expect(result).toEqual({ amount: 300, discount: 0 });
  });
});
