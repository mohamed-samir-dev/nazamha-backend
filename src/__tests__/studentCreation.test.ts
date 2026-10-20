jest.mock("../services/atomicController", () => ({ atomicController: (handler: unknown) => handler, series: (queries: PromiseLike<unknown>[]) => Promise.all(queries) }));
import { addStudent } from "../controllers/students.crud.controller";
import { Student } from "../models/Student";
import { Teacher } from "../models/Teacher";
import { SiblingFamily } from "../models/SiblingFamily";

const teacherId = "111111111111111111111111";
const response = (): any => ({ statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json: jest.fn() });
afterEach(() => jest.restoreAllMocks());

test("creation never passes caller-supplied identity, history or family discounts to storage", async () => {
  jest.spyOn(Teacher, "findById").mockReturnValue({ select: () => ({ lean: async () => ({}) }) } as any);
  const create = jest.spyOn(Student, "create").mockRejectedValue(new Error("stop before persistence"));
  const r = response();
  await expect(addStudent({ user: { id: teacherId, user_type: "teacher" }, body: {
    name: "Test Student", _id: "222222222222222222222222", teacher_id: "attacker",
    created_at: "2000-01-01", group_join_date: "2000-01-01", mutation_version: 99,
    months: [true], is_suspended: true, sibling_family_id: "foreign-family",
    family_discount_percent: 100, family_book_discount_percent: 100,
  } } as any, r)).rejects.toThrow("stop before persistence");
  expect(create).toHaveBeenCalledWith({ name: "Test Student", teacher_id: teacherId });
});

test("joining a family owned by another teacher fails before creating the student", async () => {
  const findMember = jest.spyOn(Student, "findOne").mockResolvedValue(null);
  const findFamily = jest.spyOn(SiblingFamily, "findOne").mockResolvedValue(null);
  const create = jest.spyOn(Student, "create");
  const r = response();
  const familyId = "333333333333333333333333";
  await addStudent({ user: { id: teacherId, user_type: "teacher" }, body: { name: "Test Student", join_family_id: familyId } } as any, r);
  expect(r.statusCode).toBe(400);
  expect(findMember).toHaveBeenCalledWith({ teacher_id: teacherId, sibling_family_id: familyId });
  expect(findFamily).toHaveBeenCalledWith({ _id: familyId, teacher_id: teacherId });
  expect(create).not.toHaveBeenCalled();
});
