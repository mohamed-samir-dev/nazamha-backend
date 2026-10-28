import {
  evaluatePaymentScan,
  getDatePartsInTimezone,
  getPreviousMonth,
  getNextMonth,
  getArabicMonthName,
} from "../utils/paymentGraceUtils";

describe("Payment Grace Period & Scan Logic", () => {
  const baseStudent = {
    id: "stud-1",
    name: "أحمد علي",
    is_suspended: false,
  };

  const createSub = (month: number, year: number, status = "due", amount = 200, discount = 20) => ({
    _id: `sub-${month}-${year}`,
    student_id: baseStudent.id,
    month,
    year,
    status,
    amount,
    discount,
  });

  // 1. طالب منتظم يريد دفع الشهر المستحق: يتم الدفع تلقائيًا
  test("Case 1: Regular student paying current month on time pays automatically", () => {
    // Current date: 15 October 2026
    const currentDate = new Date("2026-10-15T12:00:00Z");
    const subscriptions = [
      createSub(9, 2026, "paid"),
      createSub(10, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("regular_auto");
    expect(result.action).toBe("auto_pay");
    expect(result.eligibleForAuto).toBe(true);
    expect(result.payPeriod).toEqual({ month: 10, year: 2026 });
    expect(result.message).toBe("تم تسجيل دفع شهر أكتوبر بنجاح.");
  });

  // 2. طالب يسدد الشهر السابق خلال فترة السماح: يتم الدفع تلقائيًا للشهر السابق
  test("Case 2: Student paying previous month within grace period pays automatically", () => {
    // Current date: 5 October 2026 (day 5 is within 10-day grace period for September)
    const currentDate = new Date("2026-10-05T12:00:00Z");
    const subscriptions = [
      createSub(8, 2026, "paid"),
      createSub(9, 2026, "due"),
      createSub(10, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
      gracePeriodDays: 10,
    });

    expect(result.status).toBe("grace_period_auto");
    expect(result.action).toBe("auto_pay");
    expect(result.eligibleForAuto).toBe(true);
    expect(result.isGracePeriod).toBe(true);
    expect(result.payPeriod).toEqual({ month: 9, year: 2026 });
    expect(result.message).toBe("تم تسجيل دفع شهر سبتمبر بنجاح خلال فترة السماح.");
  });

  // 3. طالب عليه شهر أقدم غير مدفوع ويحاول دفع شهر أحدث: لا يتم الدفع تلقائيًا وتظهر رسالة متأخرات
  test("Case 3: Student has older arrears and tries to pay newer month requires confirmation", () => {
    // Current date: 15 October 2026, September unpaid, August paid
    const currentDate = new Date("2026-10-15T12:00:00Z");
    const subscriptions = [
      createSub(8, 2026, "paid"),
      createSub(9, 2026, "due"),
      createSub(10, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
      gracePeriodDays: 10,
    });

    expect(result.status).toBe("arrears_require_confirmation");
    expect(result.action).toBe("require_confirmation");
    expect(result.eligibleForAuto).toBe(false);
    expect(result.arrears).toHaveLength(1);
    expect(result.arrears[0]).toEqual({ month: 9, year: 2026 });
    expect(result.message).toContain("الطالب عليه متأخرات عن شهر سبتمبر");
    expect(result.message).toContain("هل تريد المتابعة وتسجيل الدفع عن شهر أكتوبر؟");
  });

  // 4. طالب تجاوز فترة السماح: تظهر رسالة التأكيد المناسبة
  test("Case 4: Student exceeded grace period (e.g. October 12) requires teacher confirmation", () => {
    // Current date: 12 October 2026 (> 10 days grace period for September)
    const currentDate = new Date("2026-10-12T12:00:00Z");
    const subscriptions = [
      createSub(8, 2026, "paid"),
      createSub(9, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 9,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
      gracePeriodDays: 10,
    });

    expect(result.status).toBe("grace_period_expired");
    expect(result.action).toBe("require_confirmation");
    expect(result.eligibleForAuto).toBe(false);
    expect(result.payPeriod).toEqual({ month: 9, year: 2026 });
    expect(result.message).toBe("الطالب لم يسدد اشتراك شهر سبتمبر خلال فترة السماح. هل تريد تسجيل الدفع عن شهر سبتمبر الآن؟");
  });

  // 5. طالب دفع الشهر بالفعل: يمنع تكرار الدفع
  test("Case 5: Student already paid the month reports already paid", () => {
    const currentDate = new Date("2026-10-15T12:00:00Z");
    const subscriptions = [
      createSub(9, 2026, "paid"),
      createSub(10, 2026, "paid"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("already_paid");
    expect(result.action).toBe("none");
    expect(result.eligibleForAuto).toBe(false);
    expect(result.message).toBe("اشتراك شهر أكتوبر مدفوع بالفعل، ولا يمكن تسجيل الدفع مرة أخرى.");
  });

  // 6. طالب موقوف: يتطلب مراجعة المدرس
  test("Case 6: Suspended student requires review and prevents auto payment", () => {
    const currentDate = new Date("2026-10-15T12:00:00Z");
    const subscriptions = [createSub(10, 2026, "due")];

    const result = evaluatePaymentScan({
      student: { ...baseStudent, is_suspended: true },
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("suspended");
    expect(result.eligibleForAuto).toBe(false);
    expect(result.action).toBe("require_confirmation");
    expect(result.message).toContain("الطالب موقوف");
  });

  // 7. الطالب لديه عدة أشهر متأخرة: تظهر المتأخرات بشكل صحيح
  test("Case 7: Multiple overdue months are listed clearly in arrears message", () => {
    const currentDate = new Date("2026-10-15T12:00:00Z");
    const subscriptions = [
      createSub(7, 2026, "due"),
      createSub(8, 2026, "due"),
      createSub(9, 2026, "due"),
      createSub(10, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("arrears_require_confirmation");
    expect(result.arrears).toHaveLength(3);
    expect(result.message).toContain("يوليو");
    expect(result.message).toContain("أغسطس");
    expect(result.message).toContain("سبتمبر");
    expect(result.message).toContain("أكتوبر");
  });

  // 8. الدفع عند بداية سنة جديدة (يناير) مع شهر ديسمبر السابق
  test("Case 8: Year transition (December to January) calculates grace period correctly", () => {
    // Current date: 5 January 2027 (day 5 of Jan 2027 is within grace period for Dec 2026)
    const currentDate = new Date("2027-01-05T12:00:00Z");
    const subscriptions = [
      createSub(11, 2026, "paid"),
      createSub(12, 2026, "due"),
      createSub(1, 2027, "due"),
    ];

    const resultInGrace = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 1,
      targetYear: 2027,
      currentDate,
      timezone: "Africa/Cairo",
      gracePeriodDays: 10,
    });

    expect(resultInGrace.status).toBe("grace_period_auto");
    expect(resultInGrace.payPeriod).toEqual({ month: 12, year: 2026 });
    expect(resultInGrace.message).toBe("تم تسجيل دفع شهر ديسمبر بنجاح خلال فترة السماح.");

    // After grace period: 15 January 2027
    const afterGraceDate = new Date("2027-01-15T12:00:00Z");
    const resultAfterGrace = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 12,
      targetYear: 2026,
      currentDate: afterGraceDate,
      timezone: "Africa/Cairo",
      gracePeriodDays: 10,
    });

    expect(resultAfterGrace.status).toBe("grace_period_expired");
    expect(resultAfterGrace.payPeriod).toEqual({ month: 12, year: 2026 });
    expect(resultAfterGrace.message).toBe("الطالب لم يسدد اشتراك شهر ديسمبر خلال فترة السماح. هل تريد تسجيل الدفع عن شهر ديسمبر الآن؟");
  });

  // 9. الدفع قرب نهاية الشهر (مثلاً 31 أكتوبر)
  test("Case 9: End of month payment pays current month normally", () => {
    const currentDate = new Date("2026-10-31T20:00:00Z");
    const subscriptions = [
      createSub(9, 2026, "paid"),
      createSub(10, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("regular_auto");
    expect(result.eligibleForAuto).toBe(true);
    expect(result.payPeriod).toEqual({ month: 10, year: 2026 });
  });

  // 10. الطالب لديه اشتراك بدأ في منتصف العام (أكتوبر مثلاً بدون أغسطس وسبتمبر)
  test("Case 10: Student enrolled mid-year starting in October has no arrears from earlier months", () => {
    const currentDate = new Date("2026-10-15T12:00:00Z");
    // Only October onwards exists
    const subscriptions = [
      createSub(10, 2026, "due"),
      createSub(11, 2026, "not_due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("regular_auto");
    expect(result.eligibleForAuto).toBe(true);
    expect(result.payPeriod).toEqual({ month: 10, year: 2026 });
  });

  // 11. شهر سابق معفي (exempt): لا يُعتبر متأخرات
  test("Case 11: Exempt previous month does not count as arrears", () => {
    const currentDate = new Date("2026-10-15T12:00:00Z");
    const subscriptions = [
      createSub(9, 2026, "exempt"),
      createSub(10, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 10,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
    });

    expect(result.status).toBe("regular_auto");
    expect(result.eligibleForAuto).toBe(true);
    expect(result.payPeriod).toEqual({ month: 10, year: 2026 });
  });

  // 12. اختلاف المنطقة الزمنية بين السيرفر وتوقيت النظام (Africa/Cairo)
  test("Case 12: Timezone resolution accurately respects Africa/Cairo across UTC boundaries", () => {
    // 2026-10-10 22:30:00 UTC = 2026-10-11 01:30:00 Cairo time (UTC+3 summer time)
    const dateOnBoundary = new Date("2026-10-10T22:30:00Z");
    const partsCairo = getDatePartsInTimezone(dateOnBoundary, "Africa/Cairo");

    expect(partsCairo.day).toBe(11); // Day 11 in Cairo
    expect(partsCairo.month).toBe(10);
    expect(partsCairo.year).toBe(2026);

    // In Cairo on day 11, grace period of 10 days has expired for September
    const subscriptions = [
      createSub(8, 2026, "paid"),
      createSub(9, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 9,
      targetYear: 2026,
      currentDate: dateOnBoundary,
      timezone: "Africa/Cairo",
      gracePeriodDays: 10,
    });

    expect(result.status).toBe("grace_period_expired");
    expect(result.eligibleForAuto).toBe(false);
  });

  // 13. فترة سماح مخصصة (مثلاً 15 يوماً بدلاً من 10)
  test("Case 13: Configurable grace period (e.g. 15 days) is respected", () => {
    // Day 12 of October: with 15-day grace period, it is still within grace period!
    const currentDate = new Date("2026-10-12T12:00:00Z");
    const subscriptions = [
      createSub(8, 2026, "paid"),
      createSub(9, 2026, "due"),
    ];

    const result = evaluatePaymentScan({
      student: baseStudent,
      subscriptions,
      targetMonth: 9,
      targetYear: 2026,
      currentDate,
      timezone: "Africa/Cairo",
      gracePeriodDays: 15,
    });

    expect(result.status).toBe("grace_period_auto");
    expect(result.eligibleForAuto).toBe(true);
    expect(result.isGracePeriod).toBe(true);
    expect(result.payPeriod).toEqual({ month: 9, year: 2026 });
  });
});
