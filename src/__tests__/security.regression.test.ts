jest.mock("../services/counters", () => ({ nextSequence: jest.fn().mockResolvedValue(1) }));
jest.mock("../services/atomicController", () => ({ atomicController: (handler: unknown) => handler, series: (queries: PromiseLike<unknown>[]) => Promise.all(queries) }));
import { CenterStudent } from "../models/CenterStudent";
import { StudentMembership } from "../models/StudentMembership";
import { SiblingFamily } from "../models/SiblingFamily";
import { renameFamiliy } from "../controllers/students.siblings.controller";
import { resolveOrCreateCenterStudent } from "../controllers/students.helpers";
import { Response, NextFunction } from "express";
import { AuthRequest, protect, teacherFilter } from "../middleware/auth";
import { enforceResourcePermissions } from "../middleware/resourcePermissions";
import { Teacher } from "../models/Teacher";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { CenterStaff } from "../models/CenterStaff";
import { Center } from "../models/Center";
import { Salary } from "../models/Salary";
import { Question } from "../models/Question";
import { QuestionBank } from "../models/QuestionBank";
import { Exam, ExamGrade } from "../models/Exam";
import { StudentShareToken } from "../models/StudentShareToken";
import { isTokenRevoked } from "../services/tokenBlacklist";
import jwt from "jsonwebtoken";
import { getTeacherById, updateTeacher } from "../controllers/teachersController";
import { deleteGroup, deleteGroupsBulk, updateGroupsByGrade } from "../controllers/groupsController";
import { updateSubscription } from "../controllers/subscriptionsController";
import { updateStudent } from "../controllers/students.crud.controller";
import { getSalaries, confirmSalaryPayment } from "../controllers/salariesController";
import { updateQuestion } from "../controllers/questionBanksController";
import { upsertGrades } from "../controllers/examsController";
import { getPublicCenterStudentReport } from "../controllers/publicController";
import { generateShareToken, revokeShareToken } from "../controllers/students.shareToken.controller";
import { prepareAttendance } from "../utils/prepareAttendance";

jest.mock("../services/tokenBlacklist", () => ({ isTokenRevoked: jest.fn().mockResolvedValue(false) }));
const A = "111111111111111111111111", B = "222222222222222222222222", S = "333333333333333333333333", G = "444444444444444444444444";
const chain = (value: unknown): any => ({
  lean() { return this; }, select() { return this; }, sort() { return this; },
  then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(value).then(resolve, reject); },
});
const teacher = { id: A, user_type: "teacher", is_admin: false, is_super_admin: false, financial_permissions: [] };
const admin = { ...teacher, user_type: "admin", is_admin: true, allowed_teacher_ids: [] };
const req = (extra: Record<string, unknown> = {}): AuthRequest => ({ user: teacher, body: {}, params: {}, query: {}, headers: {}, cookies: {}, baseUrl: "/api/groups", path: "/", method: "GET", ...extra } as unknown as AuthRequest);
const res = (): any => ({ statusCode: 200, locals: {}, status(n: number) { this.statusCode = n; return this; }, json: jest.fn(), set: jest.fn(), sendStatus: jest.fn() });
afterEach(() => jest.restoreAllMocks());

describe("tenant boundaries", () => {
  test("bulk grade pricing updates unpaid subscriptions with discounts and tenant scope", async () => {
    jest.spyOn(Group, "find").mockReturnValue(chain([{ _id: G, teacher_id: A }]));
    jest.spyOn(Group, "updateMany").mockResolvedValue({ modifiedCount: 1 } as any);
    const students = jest.spyOn(Student, "find").mockReturnValue(chain([{ _id: S, family_discount_percent: 20, discount_value: 10 }]));
    const write = jest.spyOn(MonthlySubscription, "bulkWrite").mockResolvedValue({} as any);
    const response = res();
    await updateGroupsByGrade(req({ params: { gradeId: G }, body: { monthly_price: 300 } }), response);
    expect(response.statusCode).toBe(200);
    expect(students).toHaveBeenCalledWith(expect.objectContaining({ teacher_id: A, group_id: { $in: [G] }, custom_monthly_price: { $in: [null, false, 0] } }), expect.anything());
    expect(write).toHaveBeenCalledWith([{ updateMany: {
      filter: { student_id: S, teacher_id: A, status: { $in: ["due", "not_due"] } },
      update: { amount: 300, discount: 60 },
    } }]);
  });
  test("group cascade rejects history before deleting any students", async () => {
    const removeGroup = jest.fn();
    jest.spyOn(Group, "findOne").mockResolvedValue({ _id: G, deleteOne: removeGroup } as any);
    jest.spyOn(Student, "find").mockReturnValue(chain([{ _id: S }]));
    jest.spyOn(AttendanceRecord, "exists").mockResolvedValue({ _id: G } as any);
    jest.spyOn(StudentMembership, "exists").mockResolvedValue(null);
    jest.spyOn(MonthlySubscription, "exists").mockResolvedValue(null);
    jest.spyOn(ExamGrade, "exists").mockResolvedValue(null);
    const { BookSale } = await import("../models/BookSale");
    jest.spyOn(BookSale, "exists").mockResolvedValue(null);
    const removeStudents = jest.spyOn(Student, "deleteMany");
    const response = res();
    await deleteGroup(req({ params: { id: G }, body: { deleteStudents: true } }), response);
    expect(response.statusCode).toBe(409);
    expect(removeGroup).not.toHaveBeenCalled();
    expect(removeStudents).not.toHaveBeenCalled();
  });
  test("group-only staff cannot cascade-delete students", async () => {
    jest.spyOn(Group, "findOne").mockResolvedValue({ _id: G } as any);
    const lookup = jest.spyOn(Student, "find");
    const response = res();
    await deleteGroup(req({ user: { ...teacher, staff_permissions: ["groups"] }, params: { id: G }, body: { deleteStudents: true } }), response);
    expect(response.statusCode).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
  });
  test("family rename scopes the family document to its teacher", async () => {
    jest.spyOn(Student, "updateMany").mockResolvedValue({ matchedCount: 0 } as any);
    const update = jest.spyOn(SiblingFamily, "findOneAndUpdate").mockResolvedValue(null);
    const response = res();
    await renameFamiliy(req({ body: { familyId: B, familyName: "عائلة" } }), response);
    expect(update).toHaveBeenCalledWith({ _id: B, teacher_id: A }, { family_name: "عائلة" });
    expect(response.statusCode).toBe(404);
  });
  test("legacy family identifiers can be renamed through owned members", async () => {
    jest.spyOn(Student, "updateMany").mockResolvedValue({ matchedCount: 1 } as any);
    const update = jest.spyOn(SiblingFamily, "findOneAndUpdate");
    const response = res();
    await renameFamiliy(req({ body: { familyId: "FAM-legacy", familyName: "عائلة" } }), response);
    expect(update).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
  });
  test.each([getTeacherById, updateTeacher])("limited admin cannot reach foreign teacher handler %p", async handler => {
    const lookup = jest.spyOn(Teacher, "findById");
    const response = res(); await handler(req({ user: admin, params: { id: B } }), response);
    expect(response.statusCode).toBe(403); expect(lookup).not.toHaveBeenCalled();
  });
  test("bulk group cascade remains scoped even for foreign identifiers", async () => {
    jest.spyOn(StudentMembership, "exists").mockResolvedValue(null);
    jest.spyOn(Student, "find").mockReturnValue(chain([]));
    jest.spyOn(AttendanceRecord, "exists").mockResolvedValue(null);
    jest.spyOn(Group, "deleteMany").mockResolvedValue({ deletedCount: 0 } as any);
    jest.spyOn(Student, "updateMany").mockResolvedValue({} as any);
    const remove = jest.spyOn(AttendanceRecord, "deleteMany").mockResolvedValue({ deletedCount: 0 } as any);
    await deleteGroupsBulk(req({ body: { ids: [G] } }), res());
    expect(remove).toHaveBeenCalledWith({ group_id: { $in: [G] }, teacher_id: A });
  });
  test("foreign group rejected before modifying student", async () => {
    jest.spyOn(Student, "findOne").mockReturnValue(chain({ _id: S, teacher_id: A }));
    jest.spyOn(Group, "findOne").mockReturnValue(chain(null));
    const write = jest.spyOn(Student, "findOneAndUpdate"); const response = res();
    await updateStudent(req({ params: { id: S }, body: { group_id: G } }), response);
    expect(response.statusCode).toBe(403); expect(write).not.toHaveBeenCalled();
  });
  test("center report without validated identity cannot query students", async () => {
    const find = jest.spyOn(Student, "find"); const response = res();
    await getPublicCenterStudentReport(req({ params: { centerCode: "ABC-0001" } }), response);
    expect(response.statusCode).toBe(401); expect(find).not.toHaveBeenCalled();
  });
  test("teacher filter never expands assistant scope", () => {
    expect(teacherFilter(req({ user: { ...teacher, actor_id: B, actor_type: "staff", staff_permissions: [] } }))).toEqual({ teacher_id: A });
  });
});
describe("delegation and financial permissions", () => {
  test.each([
    ["/api/groups", "POST", {}, []],
    ["/api/teachers", "PATCH", {}, ["teachers"]],
    ["/api/students", "PATCH", { discount_value: 50 }, ["students"]],
  ])("staff is denied %s %s", (baseUrl, method, body, permissions) => {
    const response = res(), next = jest.fn();
    enforceResourcePermissions(req({ baseUrl, method, body, user: { ...teacher, staff_permissions: permissions } }), response, next);
    expect(response.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
  });
  test("attendance delegate can read groups required for attendance", () => {
    const next = jest.fn(); enforceResourcePermissions(req({ user: { ...teacher, staff_permissions: ["attendance"] } }), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
  test.each(["/api/bills", "/api/subscriptions", "/api/salaries", "/api/books"])("admin without financial grant denied %s", baseUrl => {
    const response = res(); enforceResourcePermissions(req({ user: admin, baseUrl, method: "PATCH" }), response, jest.fn());
    expect(response.statusCode).toBe(403);
  });
  test("financial editor can edit invoice in its ownership scope", () => {
    const next = jest.fn(); enforceResourcePermissions(req({ user: { ...admin, financial_permissions: ["financial.editInvoices"] }, baseUrl: "/api/bills", method: "PATCH" }), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
describe("financial and assessment regression", () => {
  test("notes preserve paid timestamp", async () => {
    const write = jest.spyOn(MonthlySubscription, "findOneAndUpdate").mockResolvedValue({ student_id: S, teacher_id: A } as any);
    await updateSubscription(req({ params: { id: S }, body: { notes: "note" } }), res());
    expect(write.mock.calls[0][1]).toEqual({ $set: { notes: "note" } });
  });
  test("empty subscription mutation is rejected", async () => {
    const response = res(); await updateSubscription(req({ params: { id: S } }), response); expect(response.statusCode).toBe(400);
  });
  test("generated salary replaces the virtual month", async () => {
    jest.spyOn(Salary, "find").mockReturnValue(chain([
      { _id: A, teacher_id: A, employee_name: "Test", role: "Test", is_recurring: true, start_year: 2026, start_month: 1, end_year: 2026, end_month: 1, amount: 100 },
      { _id: B, teacher_id: A, employee_name: "Test", role: "Test", is_virtual_instance: true, year: 2026, month: 1, amount: 100 },
    ]));
    const response = res(); await getSalaries(req({ query: { year: "2026" } }), response);
    expect(response.json.mock.calls[0][0]).toHaveLength(1);
  });
  test("question cannot be moved to a foreign bank by update", async () => {
    jest.spyOn(Question, "findById").mockReturnValue(chain({ _id: S, bank_id: A }));
    jest.spyOn(QuestionBank, "findOne").mockResolvedValue({ _id: A } as any);
    const write = jest.spyOn(Question, "findByIdAndUpdate").mockReturnValue(chain({ _id: S }));
    await updateQuestion(req({ params: { id: S }, body: { bank_id: B, content: "Safe" } }), res());
    expect(write.mock.calls[0][1]).toEqual({ $set: { content: "Safe" } });
  });
  test.each([-1, 101, NaN])("out of range score %p never written", async score => {
    jest.spyOn(Exam, "findOne").mockResolvedValue({ _id: G, max_score: 100 } as any);
    const write = jest.spyOn(ExamGrade, "bulkWrite"), response = res();
    await upsertGrades(req({ params: { examId: G }, body: { grades: [{ student_id: S, score }] } }), response);
    expect(response.statusCode).toBe(400); expect(write).not.toHaveBeenCalled();
  });
  test("foreign exam student rejected", async () => {
    jest.spyOn(Exam, "findOne").mockResolvedValue({ _id: G, max_score: 100, group_id: G } as any);
    jest.spyOn(Student, "countDocuments").mockResolvedValue(0);
    const response = res(); await upsertGrades(req({ params: { examId: G }, body: { grades: [{ student_id: S, score: 50 }] } }), response);
    expect(response.statusCode).toBe(403);
  });
});
describe("session lifecycle and sharing", () => {
  beforeEach(() => { process.env.JWT_SECRET = "synthetic-test-secret-not-a-deployment-value"; });
  test("old session version rejected after password reset", async () => {
    jest.spyOn(Teacher, "findById").mockReturnValue(chain({ _id: A, is_active: true, session_version: 1 }));
    const response = res(), next = jest.fn();
    await protect(req({ cookies: { token: jwt.sign({ id: A, user_type: "teacher", version: 0 }, process.env.JWT_SECRET!) } }), response, next);
    expect(response.statusCode).toBe(401); expect(next).not.toHaveBeenCalled();
  });
  test("fresh valid teacher session proceeds", async () => {
    jest.spyOn(Teacher, "findById").mockReturnValue(chain({ _id: A, is_active: true, session_version: 1 }));
    const next = jest.fn(); await protect(req({ cookies: { token: jwt.sign({ id: A, user_type: "teacher", version: 1 }, process.env.JWT_SECRET!) } }), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
  test("disabled teacher cannot reuse previous authorization", async () => {
    jest.spyOn(Teacher, "findById").mockReturnValueOnce(chain({ _id: A, is_active: true })).mockReturnValueOnce(chain({ _id: A, is_active: false }));
    const token = jwt.sign({ id: A, user_type: "teacher" }, process.env.JWT_SECRET!);
    await protect(req({ cookies: { token } }), res(), jest.fn());
    const response = res(); await protect(req({ cookies: { token } }), response, jest.fn());
    expect(response.statusCode).toBe(403);
  });
  test("share token uses actual owner and matching frontend route", async () => {
    jest.spyOn(Student, "findOne").mockReturnValue(chain({ _id: S, teacher_id: B }));
    const create = jest.spyOn(StudentShareToken, "create").mockResolvedValue({} as never);
    const response = res(); await generateShareToken(req({ user: { ...admin, is_super_admin: true }, params: { id: S }, body: { ttl_hours: 24 } }), response);
    expect((create.mock.calls[0][0] as any).teacher_id).toBe(B);
    expect(response.json.mock.calls[0][0].share_url).toContain("/report/" + S + "?token=");
  });
  test("revocation covers tokens created by other authorized actors", async () => {
    jest.spyOn(Student, "findOne").mockReturnValue(chain({ _id: S, teacher_id: A }));
    const remove = jest.spyOn(StudentShareToken, "deleteMany").mockResolvedValue({ deletedCount: 2 } as any);
    await revokeShareToken(req({ params: { id: S } }), res());
    expect(remove).toHaveBeenCalledWith({ student_id: S });
  });
});
describe("attendance input validation", () => {
  test.each(["invalid", "2026-02-30", "2099-01-01"])("rejects invalid/future date %s", async session_date => {
    await expect(prepareAttendance(A, { _id: S, group_id: G }, { session_date, status: "present" })).rejects.toThrow();
  });
  test("date determines month/year and original group", async () => {
    jest.spyOn(Group, "findOne").mockReturnValue(chain({ _id: G, day_of_week: "السبت", name: "Test" }));
    const record = await prepareAttendance(A, { _id: S, group_id: G }, { session_date: "2025-01-01", status: "present", month: 7, year: 2099 });
    expect(record).toMatchObject({ month: 1, year: 2025, group_id: G, teacher_id: A });
  });
});



describe("monthly recurring payments", () => {
  test("rejects paying a recurring template without a period", async () => {
    jest.spyOn(Salary, "findOne").mockResolvedValue({ _id: S, teacher_id: A, is_recurring: true } as never);
    const update = jest.spyOn(Salary, "findOneAndUpdate");
    const response = res(); await confirmSalaryPayment(req({ params: { id: S } }), response);
    expect(response.statusCode).toBe(400); expect(update).not.toHaveBeenCalled();
  });
  test("pays only the selected month and leaves the template unchanged", async () => {
    jest.spyOn(Salary, "findOne").mockResolvedValue({ _id: S, teacher_id: A, is_recurring: true, start_year: 2026, start_month: 1, employee_name: "Test", role: "assistant", amount: 100 } as never);
    const update = jest.spyOn(Salary, "findOneAndUpdate").mockResolvedValue({} as never);
    await confirmSalaryPayment(req({ params: { id: S }, body: { month: 10, year: 2026 } }), res());
    expect(update.mock.calls[0][0]).toEqual({ template_id: S, month: 10, year: 2026, teacher_id: A });
    expect(update.mock.calls[0][1]).toMatchObject({ $set: { payment_status: "paid" }, $setOnInsert: { is_recurring: false, is_virtual_instance: true } });
  });
});

describe("identity and financial response boundaries", () => {
  test("a student without a phone gets a separate identity and no invented phone", async () => {
    jest.spyOn(Center, "findById").mockReturnValue(chain({ name: "Test Center" }));
    const find = jest.spyOn(CenterStudent, "findOne").mockReturnValue(chain(null));
    const update = jest.spyOn(CenterStudent, "findOneAndUpdate").mockResolvedValue({ _id: S, center_student_code: "TES-0001" } as never);
    await resolveOrCreateCenterStudent(A, "Test Student", "");
    expect(find.mock.calls[0][0]).toMatchObject({ center_id: A, _id: expect.anything() });
    expect(update.mock.calls[0][1]).toMatchObject({ $setOnInsert: { parent_phone: "", seq: 1, center_prefix: "TES" } });
  });
  test("attendance-only assistants cannot read dashboard payments", () => {
    const response = res(), next = jest.fn();
    enforceResourcePermissions(req({ user: { ...teacher, staff_permissions: ["attendance"] }, baseUrl: "/api/dashboard", path: "/payments" }), response, next);
    expect(response.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
  });
  test("student reads omit prices for attendance-only assistants", () => {
    const response = res(), send = response.json;
    enforceResourcePermissions(req({ user: { ...teacher, staff_permissions: ["attendance"] }, baseUrl: "/api/students" }), response, jest.fn());
    response.json([{ id: S, name: "Test", custom_monthly_price: 99, discount_value: 5 }]);
    expect(send).toHaveBeenCalledWith([{ id: S, name: "Test" }]);
  });
});
