jest.mock("../services/atomicController", () => ({ atomicController: (handler: unknown) => handler, series: (queries: PromiseLike<unknown>[]) => Promise.all(queries) }));
import { enforceResourcePermissions } from "../middleware/resourcePermissions";
import { syncAllStudentsForTeacher } from "../services/subscriptionLifecycle";
import { fixRolloverData, rolloverAcademicYear, getSubscriptionsSummary } from "../controllers/subscriptionsController";
import { getStudentBooks } from "../controllers/booksController";
import { Teacher } from "../models/Teacher";
import { Student } from "../models/Student";
import { Book } from "../models/Book";
import { BookSale } from "../models/BookSale";
import { MonthlySubscription } from "../models/MonthlySubscription";

const T = "111111111111111111111111", S = "222222222222222222222222", B = "333333333333333333333333";
const chain = (value: unknown): any => ({ lean() { return this; }, select() { return this; }, sort() { return this; }, then(resolve: any, reject: any) { return Promise.resolve(value).then(resolve, reject); } });
const response = (): any => ({ statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json: jest.fn() });
const owner = { id: T, user_type: "teacher", is_admin: false, financial_permissions: [] };
const request = (extra: object = {}): any => ({ user: owner, method: "POST", baseUrl: "/api/students", path: "/", body: {}, params: {}, query: {}, ...extra });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe("financial permission boundaries", () => {
  const routes = [
    ["POST", "/link-siblings", { studentIds: [S, B] }],
    ["POST", "/unlink-sibling", { studentId: S }],
    ["POST", "/transfer-family", { studentId: S, targetFamilyId: B }],
    ["DELETE", "/family/abc", {}],
    ["PATCH", "/" + S, { group_id: B }],
    ["PATCH", "/" + S, { subscription_start_month: 12, subscription_start_year: 2026 }],
    ["POST", "/bulk", { students: [{ name: "طالب اختبار", custom_monthly_price: 1 }] }],
  ] as const;
  test.each(routes)("staff without payments cannot %s %s", (method, path, body) => {
    const res = response(), next = jest.fn();
    enforceResourcePermissions(request({ method, path, body, user: { ...owner, staff_permissions: ["students"] } }), res, next);
    expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
  });
  test.each(routes)("authorized staff can %s %s", (method, path, body) => {
    const res = response(), next = jest.fn();
    enforceResourcePermissions(request({ method, path, body, user: { ...owner, staff_permissions: ["students", "payments"] } }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
  test.each(["POST", "PATCH"])("nested financial fields are denied to admins without applyDiscount (%s)", method => {
    const res = response(), next = jest.fn();
    enforceResourcePermissions(request({ method, path: "/bulk", body: { teacher_id: T, students: [{ custom_monthly_price: 1, discount_value: 90 }] }, user: { ...owner, is_admin: true, financial_permissions: ["financial.viewRevenue"] } }), res, next);
    expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
  });
  test("financial permissions permit nested custom prices but do not grant another module", () => {
    const res = response(), next = jest.fn();
    enforceResourcePermissions(request({ path: "/bulk", body: { students: [{ custom_monthly_price: 100 }] }, user: { ...owner, is_admin: true, financial_permissions: ["financial.applyDiscount"] } }), res, next);
    expect(next).toHaveBeenCalled();
  });
  test.each([{ path: "/" + S, method: "PATCH", body: { name: "اسم جديد", parent_phone: "01012345678" } }, { path: "/rename-family", body: { familyId: "abc", familyName: "عائلة جديدة" } }])("ordinary administrative edits remain available", edit => {
    const next = jest.fn(); enforceResourcePermissions(request({ ...edit, user: { ...owner, staff_permissions: ["students"] } }), response(), next); expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("academic calendar never deletes the ledger", () => {
  function setup() {
    jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    jest.spyOn(Teacher, "findById").mockReturnValue(chain({ monthly_price: 100, academic_year: { active_month_years: [{ month: 10, year: 2025 }, { month: 10, year: 2026 }, { month: 11, year: 2026 }] } }));
    jest.spyOn(Teacher, "findByIdAndUpdate").mockResolvedValue({} as any);
    jest.spyOn(Student, "find").mockReturnValue(chain([{ _id: S, subscription_start_month: 10, subscription_start_year: 2025 }]));
    jest.spyOn(MonthlySubscription, "find").mockReturnValue(chain([
      { student_id: S, month: 10, year: 2025, status: "due", amount: 600, discount: 0 },
      { student_id: S, month: 9, year: 2025, status: "not_due", amount: 600, discount: 0 },
      { student_id: S, month: 10, year: 2026, status: "paid", amount: 80, discount: 10 },
    ]));
    return { remove: jest.spyOn(MonthlySubscription, "deleteMany"), write: jest.spyOn(MonthlySubscription, "bulkWrite").mockResolvedValue({} as any) };
  }
  test("sync generates a new period without deleting old debt or changing paid rows", async () => {
    const { remove, write } = setup(); await syncAllStudentsForTeacher(T);
    expect(remove).not.toHaveBeenCalled();
    const ops = write.mock.calls[0][0] as any[];
    expect(ops).toEqual([{ insertOne: { document: expect.objectContaining({ student_id: S, month: 11, year: 2026, amount: 100, discount: 0 }) } }]);
  });
  test("calendar repair preserves obligations in removed years", async () => {
    const { remove } = setup(), res = response(); await fixRolloverData(request(), res);
    expect(remove).not.toHaveBeenCalled(); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ removedYears: [2025], deletedSubscriptions: 0 }));
  });
  test("rollover retains prior debt and generates new-year records", async () => {
    const { remove } = setup(); await rolloverAcademicYear(request(), response()); expect(remove).not.toHaveBeenCalled();
    expect(Teacher.findByIdAndUpdate).toHaveBeenCalledWith(T, expect.objectContaining({ "academic_year.active_month_years": expect.arrayContaining([{ month: 10, year: 2027 }]) }));
  });
});

test.each(["unavailable", "available"])("purchased %s books from prior grades remain in the student's history", async status => {
  jest.spyOn(Student, "findOne").mockReturnValue(chain({ _id: S, grade_id: "444444444444444444444444" }));
  jest.spyOn(BookSale, "find").mockReturnValue(chain([{ _id: "sale", book_id: B, final_price: 400, discount: 100, status: "active" }]));
  const find = jest.spyOn(Book, "find").mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([{ _id: B, name: "Historical book", grade_id: "old-grade", status, price: 500 }]));
  const res = response(); await getStudentBooks(request({ params: { studentId: S } }), res);
  expect(find).toHaveBeenLastCalledWith({ teacher_id: T, _id: { $in: [B] } });
  expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ book_id: B, purchased: true, amount: 400, sale_id: "sale" })]);
});

test("summary IDs equal student IDs rather than the removed aggregate _id", async () => {
  jest.spyOn(MonthlySubscription, "aggregate").mockResolvedValue([{ studentId: S, overdueCount: 1 }]);
  const res = response(); await getSubscriptionsSummary(request(), res);
  expect(res.json).toHaveBeenCalledWith([{ studentId: S, overdueCount: 1, id: S }]);
});
