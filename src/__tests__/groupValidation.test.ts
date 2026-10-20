import { groupValidationError, validCalendarDate } from "../utils/groupValidation";

const valid = { name: "مجموعة", code: "QA17", day_of_week: "السبت، الإثنين", time: "15:30", monthly_price: 200 };
describe("group input validation", () => {
  test("accepts Arabic comma separated days", () => expect(groupValidationError(valid)).toBeNull());
  test.each([
    { code: "" }, { code: "1ABC" }, { monthly_price: -1 }, { monthly_price: "NaN" }, { monthly_price: true },
    { time: "24:01" }, { time: "12:60" }, { day_of_week: "unknown" },
    { sessions_per_month: 1.5 }, { start_date: "2026-02-30" }, { name: " " },
  ])("rejects invalid fields %p", change => expect(groupValidationError({ ...valid, ...change })).not.toBeNull());
  test("partial updates do not require untouched fields", () => expect(groupValidationError({ name: "جديد" }, true)).toBeNull());
  test("checks leap days", () => {
    expect(validCalendarDate("2024-02-29")).toBe(true);
    expect(validCalendarDate("2026-02-29")).toBe(false);
  });
});
