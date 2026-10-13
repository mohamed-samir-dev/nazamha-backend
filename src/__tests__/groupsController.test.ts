/**
 * Tests for groupsController logic (unit — no DB connection needed)
 * We test the pure validation/business logic by extracting it.
 */

// ─── Validation helpers (mirrors controller logic) ────────────────────────────

function validateAddGroup(body: Record<string, unknown>): string | null {
  const { name, day_of_week, time, monthly_price } = body as {
    name?: string;
    day_of_week?: string;
    time?: string;
    monthly_price?: unknown;
  };
  if (!name?.trim()) return "اسم المجموعة مطلوب";
  if (!day_of_week?.trim()) return "يوم المجموعة مطلوب";
  if (!time?.trim()) return "وقت المجموعة مطلوب";
  if (monthly_price == null || Number(monthly_price) <= 0)
    return "سعر الاشتراك الشهري مطلوب";
  return null;
}

// ─── Price sync logic (mirrors updateGroup price-change block) ────────────────

function calcNetPrice(
  newPrice: number,
  familyDiscountPct: number,
  individualDiscountPct: number
): { netPrice: number; discountAmt: number } {
  const activePct =
    familyDiscountPct > 0 ? familyDiscountPct : individualDiscountPct;
  const netPrice =
    activePct > 0 ? Math.round(newPrice * (1 - activePct / 100)) : newPrice;
  return { netPrice, discountAmt: newPrice - netPrice };
}

// ─── addGroup validation ──────────────────────────────────────────────────────

describe("validateAddGroup", () => {
  test("يقبل بيانات صحيحة", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "السبت", time: "10:00", monthly_price: 300 })
    ).toBeNull();
  });

  test("يرفض لو الاسم فاضي", () => {
    expect(
      validateAddGroup({ name: "", day_of_week: "السبت", time: "10:00", monthly_price: 300 })
    ).toBe("اسم المجموعة مطلوب");
  });

  test("يرفض لو الاسم spaces فقط", () => {
    expect(
      validateAddGroup({ name: "   ", day_of_week: "السبت", time: "10:00", monthly_price: 300 })
    ).toBe("اسم المجموعة مطلوب");
  });

  test("يرفض لو اليوم مفقود", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "", time: "10:00", monthly_price: 300 })
    ).toBe("يوم المجموعة مطلوب");
  });

  test("يرفض لو الوقت مفقود", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "السبت", time: "", monthly_price: 300 })
    ).toBe("وقت المجموعة مطلوب");
  });

  test("يرفض لو السعر صفر", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "السبت", time: "10:00", monthly_price: 0 })
    ).toBe("سعر الاشتراك الشهري مطلوب");
  });

  test("يرفض لو السعر سالب", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "السبت", time: "10:00", monthly_price: -50 })
    ).toBe("سعر الاشتراك الشهري مطلوب");
  });

  test("يرفض لو السعر null", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "السبت", time: "10:00", monthly_price: null })
    ).toBe("سعر الاشتراك الشهري مطلوب");
  });

  test("يرفض لو السعر undefined", () => {
    expect(
      validateAddGroup({ name: "مجموعة أ", day_of_week: "السبت", time: "10:00" })
    ).toBe("سعر الاشتراك الشهري مطلوب");
  });
});

// ─── calcNetPrice (price sync on group update) ────────────────────────────────

describe("calcNetPrice", () => {
  test("بدون خصم — السعر الصافي = السعر الأصلي", () => {
    expect(calcNetPrice(300, 0, 0)).toEqual({ netPrice: 300, discountAmt: 0 });
  });

  test("خصم عائلي يطغى على الخصم الفردي", () => {
    // family=20%, individual=10% → يستخدم 20%
    expect(calcNetPrice(300, 20, 10)).toEqual({ netPrice: 240, discountAmt: 60 });
  });

  test("خصم فردي فقط لما family=0", () => {
    expect(calcNetPrice(300, 0, 10)).toEqual({ netPrice: 270, discountAmt: 30 });
  });

  test("خصم 100% يجعل السعر الصافي صفر", () => {
    expect(calcNetPrice(300, 100, 0)).toEqual({ netPrice: 0, discountAmt: 300 });
  });

  test("يقرب للأقرب صحيح", () => {
    // 300 * (1 - 33/100) = 300 * 0.67 = 201
    expect(calcNetPrice(300, 33, 0)).toEqual({ netPrice: 201, discountAmt: 99 });
  });

  test("سعر جديد 500 مع خصم 20%", () => {
    expect(calcNetPrice(500, 20, 0)).toEqual({ netPrice: 400, discountAmt: 100 });
  });
});
