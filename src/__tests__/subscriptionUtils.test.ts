import {
  resolveMonthYears,
  applyDiscount,
  generateStudentCode,
  formatTimeTo12H,
} from "../utils/subscriptionUtils";

// ─── resolveMonthYears ────────────────────────────────────────────────────────

describe("resolveMonthYears", () => {
  const academicMonths = [9, 10, 11, 12, 1, 2, 3, 4, 5];

  test("يرجع array فاضي لو مفيش شهور", () => {
    expect(resolveMonthYears([], 9, 2024)).toEqual([]);
  });

  test("يعطي السنة الصحيحة لكل شهر — بداية من سبتمبر", () => {
    const result = resolveMonthYears(academicMonths, 9, 2024);
    expect(result.find((r) => r.month === 9)?.year).toBe(2024);
    expect(result.find((r) => r.month === 12)?.year).toBe(2024);
    expect(result.find((r) => r.month === 1)?.year).toBe(2025);
    expect(result.find((r) => r.month === 5)?.year).toBe(2025);
  });

  test("كل الشهور تكون due لو البداية من أول الأكاديمي", () => {
    const result = resolveMonthYears(academicMonths, 9, 2024);
    expect(result.every((r) => r.status === "due")).toBe(true);
  });

  test("الشهور قبل startMonth في الـ sorted تاخد startYear+1 وتكون due", () => {
    // طالب بدأ نوفمبر 2024 — شهور 9 و10 هيجوا في السنة الأكاديمية الجاية (2025)
    const result = resolveMonthYears(academicMonths, 11, 2024);
    const sep = result.find((r) => r.month === 9);
    const oct = result.find((r) => r.month === 10);
    const nov = result.find((r) => r.month === 11);
    const jan = result.find((r) => r.month === 1);

    // sep و oct بياخدوا year=2025 (بعد نوفمبر في الأكاديمي الجاي)
    expect(sep?.year).toBe(2025);
    expect(oct?.year).toBe(2025);
    // nov بياخد year=2024 (نفس startYear)
    expect(nov?.year).toBe(2024);
    // كلهم due لأن subDate >= startDate
    expect(sep?.status).toBe("due");
    expect(oct?.status).toBe("due");
    expect(nov?.status).toBe("due");
    expect(jan?.status).toBe("due");
  });

  test("يرتب الشهور تصاعدياً حتى لو جاءت مش مرتبة", () => {
    const result = resolveMonthYears([5, 1, 9, 12], 9, 2024);
    expect(result.map((r) => r.month)).toEqual([1, 5, 9, 12]);
  });

  test("شهر واحد فقط", () => {
    const result = resolveMonthYears([9], 9, 2024);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ month: 9, year: 2024, status: "due" });
  });

  test("لو البداية بعد كل الشهور — كلها not_due", () => {
    const result = resolveMonthYears([1, 2, 3], 9, 2024);
    expect(result.every((r) => r.status === "not_due")).toBe(true);
  });
});

// ─── applyDiscount ────────────────────────────────────────────────────────────

describe("applyDiscount", () => {
  test("يحسب الخصم بشكل صحيح", () => {
    expect(applyDiscount(300, 10)).toEqual({ amount: 300, discount: 30 });
  });

  test("خصم 0% لا يغير السعر", () => {
    expect(applyDiscount(300, 0)).toEqual({ amount: 300, discount: 0 });
  });

  test("خصم 100%", () => {
    expect(applyDiscount(300, 100)).toEqual({ amount: 300, discount: 300 });
  });

  test("خصم سالب لا يُطبق", () => {
    expect(applyDiscount(300, -10)).toEqual({ amount: 300, discount: 0 });
  });

  test("خصم أكبر من 100 لا يُطبق", () => {
    expect(applyDiscount(300, 150)).toEqual({ amount: 300, discount: 0 });
  });

  test("يقرب للأقرب صحيح — 300 * 67% = 201", () => {
    expect(applyDiscount(300, 33)).toEqual({ amount: 300, discount: 99 });
  });
});

// ─── generateStudentCode ──────────────────────────────────────────────────────

describe("generateStudentCode", () => {
  test("يولد كود بتنسيق صحيح من صفر", () => {
    expect(generateStudentCode("A", 0)).toBe("A-0001");
  });

  test("يزيد التسلسل بمقدار 1 فوق الأعلى", () => {
    expect(generateStudentCode("A", 9)).toBe("A-0010");
    expect(generateStudentCode("A", 99)).toBe("A-0100");
    expect(generateStudentCode("A", 999)).toBe("A-1000");
  });

  test("يدعم كود مجموعة متعدد الأحرف", () => {
    expect(generateStudentCode("GRP1", 0)).toBe("GRP1-0001");
  });
});

// ─── formatTimeTo12H ──────────────────────────────────────────────────────────

describe("formatTimeTo12H", () => {
  test("09:00 → 09:00 ص", () => {
    expect(formatTimeTo12H("09:00")).toBe("09:00 ص");
  });

  test("13:30 → 01:30 م", () => {
    expect(formatTimeTo12H("13:30")).toBe("01:30 م");
  });

  test("12:00 → 12:00 م", () => {
    expect(formatTimeTo12H("12:00")).toBe("12:00 م");
  });

  test("00:00 → 12:00 ص", () => {
    expect(formatTimeTo12H("00:00")).toBe("12:00 ص");
  });

  test("23:59 → 11:59 م", () => {
    expect(formatTimeTo12H("23:59")).toBe("11:59 م");
  });

  test("string فاضي يرجع فاضي", () => {
    expect(formatTimeTo12H("")).toBe("");
  });
});
