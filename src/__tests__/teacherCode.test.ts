jest.mock("../services/atomicController", () => ({ atomicController: (handler: unknown) => handler, series: (queries: PromiseLike<unknown>[]) => Promise.all(queries) }));
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { Teacher } from "../models/Teacher";
import { AuditLog } from "../models/AuditLog";
import {
  generateRawTeacherCode,
  isValidTeacherCode,
  normalizeTeacherCode,
  generateUniqueTeacherCode,
  TEACHER_CODE_CHARSET,
  TEACHER_CODE_REGEX,
} from "../utils/teacherCode";
import {
  createTeacher,
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  getMe,
  searchTeacherByCode,
} from "../controllers/teachersController";
import { backfillTeacherCodes } from "../services/teacherCodeMigration";

const response = (): any => ({
  statusCode: 200,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(data: unknown) {
    this.body = data;
    return this;
  },
  body: undefined,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Teacher Code System — Automated Tests", () => {
  // ─── 1. Format and Charset Verification ──────────────────────────────────
  test("generates code starting with NZM- and 6 unambiguous chars (no 0, 1, O, I)", () => {
    const code = generateRawTeacherCode();
    expect(code).toMatch(TEACHER_CODE_REGEX);
    expect(isValidTeacherCode(code)).toBe(true);

    // Verify confusing characters are strictly absent from the charset
    expect(TEACHER_CODE_CHARSET).not.toContain("0");
    expect(TEACHER_CODE_CHARSET).not.toContain("O");
    expect(TEACHER_CODE_CHARSET).not.toContain("1");
    expect(TEACHER_CODE_CHARSET).not.toContain("I");

    const randomSuffix = code.slice(4);
    for (const char of randomSuffix) {
      expect(TEACHER_CODE_CHARSET).toContain(char);
    }
  });

  // ─── 2. Creating a teacher through Super Admin generates a code ─────────
  test("1. Creating a teacher through Super Admin generates a code", async () => {
    const generatedCode = "NZM-8K4P2X";
    const createdDoc: any = {
      _id: "6724a1b2c3d4e5f6a7b8c9d0",
      name: "أحمد علي",
      email: "ahmed@example.com",
      teacherCode: generatedCode,
    };

    jest.spyOn(Teacher, "create").mockResolvedValue(createdDoc as any);
    jest.spyOn(AuditLog, "create").mockResolvedValue({} as any);

    const req = {
      user: { id: "admin-1", is_super_admin: true, is_admin: true, user_type: "admin" },
      body: {
        name: "أحمد علي",
        email: "ahmed@example.com",
        password: "Password123!",
      },
      ip: "127.0.0.1",
    } as unknown as AuthRequest;

    const res = response();
    await createTeacher(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.teacherCode).toBe(generatedCode);
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "teacher.create",
        new_data: expect.objectContaining({ teacherCode: generatedCode }),
      })
    );
  });

  // ─── 3. Every new teacher receives a code (pre-validate hook) ───────────
  test("2. Every new teacher receives a code via Mongoose validate hook", async () => {
    const rawTeacherDoc: any = new Teacher({
      name: "محمود حسن",
      email: "mahmoud@example.com",
      password: "Password123!",
    });

    // Mock collection findOne to simulate no duplicate existing code
    jest.spyOn(Teacher.collection, "findOne").mockResolvedValue(null as any);

    // Trigger Mongoose validation
    await rawTeacherDoc.validate();

    expect(rawTeacherDoc.teacherCode).toBeDefined();
    expect(rawTeacherDoc.teacherCode).toMatch(TEACHER_CODE_REGEX);
  });

  // ─── 4. Multiple teachers receive different codes ────────────────────────
  test("3. Multiple teachers receive different codes", () => {
    const generated = new Set<string>();
    const count = 100;

    for (let i = 0; i < count; i++) {
      const code = generateRawTeacherCode();
      expect(code).toMatch(TEACHER_CODE_REGEX);
      generated.add(code);
    }

    // All 100 codes must be strictly distinct
    expect(generated.size).toBe(count);
  });

  // ─── 5. Duplicate code collision is handled safely ───────────────────────
  test("4. Duplicate code collision is handled safely with retry", async () => {
    let attempt = 0;
    const finalCode = "NZM-7M9R5A";

    // First attempt throws 11000 duplicate key error on teacherCode
    // Second attempt succeeds
    jest.spyOn(Teacher, "create").mockImplementation(async (data: any) => {
      attempt++;
      if (attempt === 1) {
        const err: any = new Error("E11000 duplicate key error collection: teachers index: teacherCode_1 dup key");
        err.code = 11000;
        err.keyPattern = { teacherCode: 1 };
        throw err;
      }
      return {
        _id: "6724a1b2c3d4e5f6a7b8c9d1",
        ...data,
        teacherCode: finalCode,
      } as any;
    });
    jest.spyOn(AuditLog, "create").mockResolvedValue({} as any);

    const req = {
      user: { id: "admin-1", is_super_admin: true, is_admin: true, user_type: "admin" },
      body: { name: "معلم تجربة", email: "retry@example.com", password: "Password123!" },
      ip: "127.0.0.1",
    } as unknown as AuthRequest;

    const res = response();
    await createTeacher(req, res);

    expect(attempt).toBe(2);
    expect(res.statusCode).toBe(201);
    expect(res.body.teacherCode).toBe(finalCode);
  });

  // ─── 6. Updating a teacher does not change their code ────────────────────
  test("5. Updating a teacher does not change their code", async () => {
    const originalCode = "NZM-4T6W2B";

    // Test A: Super Admin updating teacher profile
    const existing = {
      _id: "teacher-1",
      name: "أحمد",
      teacherCode: originalCode,
      is_active: true,
    };
    jest.spyOn(Teacher, "findById").mockReturnValue({
      lean: async () => existing,
    } as any);

    const findByIdAndUpdateSpy = jest
      .spyOn(Teacher, "findByIdAndUpdate")
      .mockResolvedValue({ ...existing, name: "أحمد المعدل" } as any);

    const req = {
      user: { id: "admin-1", is_super_admin: true, is_admin: true, user_type: "admin" },
      params: { id: "teacher-1" },
      body: {
        name: "أحمد المعدل",
        teacherCode: "NZM-HACKED", // Malicious attempt to change code
      },
    } as unknown as AuthRequest;

    const res = response();
    await updateTeacher(req, res);

    expect(res.statusCode).toBe(200);
    // teacherCode must be excluded from the update payload
    expect(findByIdAndUpdateSpy).toHaveBeenCalledWith(
      "teacher-1",
      expect.not.objectContaining({ teacherCode: "NZM-HACKED" }),
      expect.anything()
    );

    // Test B: Mongoose pre-save hook blocks code alteration on existing document
    const doc: any = new Teacher({
      name: "سامي",
      email: "sami@example.com",
      password: "Password123!",
      teacherCode: originalCode,
    });
    doc.isNew = false;
    doc.teacherCode = "NZM-TAMPER";

    const saveHooks: any[] = (Teacher.schema as any).s.hooks._pres.get("save") || [];
    const teacherCodeHook = saveHooks.find((h: any) => h.fn.toString().includes("teacherCode"));
    let hookError: any = null;
    if (teacherCodeHook) {
      await new Promise<void>((resolve) => {
        teacherCodeHook.fn.call(doc, (err?: any) => {
          if (err) hookError = err;
          resolve();
        });
      });
    }
    expect(hookError).not.toBeNull();
    expect(hookError.message).toContain("كود المعلم دائم");
  });

  // ─── 7. Existing teachers without codes receive codes through migration ──
  test("6. Existing teachers without codes receive codes through migration", async () => {
    const mockTeachers = [
      { _id: { toString: () => "t1" }, email: "t1@test.com" }, // missing
      { _id: { toString: () => "t2" }, email: "t2@test.com", teacherCode: null }, // null
      { _id: { toString: () => "t3" }, email: "t3@test.com", teacherCode: "NZM-EXIST1" }, // existing
    ];

    const fakeCollection = {
      find: () => ({
        toArray: async () => mockTeachers,
      }),
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockImplementation(async (filter, update) => {
        return { modifiedCount: 1 };
      }),
    };

    const mockModel: any = { collection: fakeCollection };

    const report = await backfillTeacherCodes({ model: mockModel, log: false });

    expect(report.total).toBe(3);
    expect(report.alreadyHadCode).toBe(1);
    expect(report.updated).toBe(2);
    expect(report.errors).toBe(0);
    expect(fakeCollection.updateOne).toHaveBeenCalledTimes(2);
  });

  // ─── 8. Running migration twice does not change existing codes ──────────
  test("7. Running migration twice does not change existing codes (idempotent)", async () => {
    const mockTeachersWithCodes = [
      { _id: { toString: () => "t1" }, email: "t1@test.com", teacherCode: "NZM-CODE01" },
      { _id: { toString: () => "t2" }, email: "t2@test.com", teacherCode: "NZM-CODE02" },
      { _id: { toString: () => "t3" }, email: "t3@test.com", teacherCode: "NZM-CODE03" },
    ];

    const fakeCollection = {
      find: () => ({
        toArray: async () => mockTeachersWithCodes,
      }),
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn(),
    };

    const mockModel: any = { collection: fakeCollection };

    const report = await backfillTeacherCodes({ model: mockModel, log: false });

    expect(report.total).toBe(3);
    expect(report.alreadyHadCode).toBe(3);
    expect(report.updated).toBe(0);
    expect(report.errors).toBe(0);
    expect(fakeCollection.updateOne).not.toHaveBeenCalled();
  });

  // ─── 9. Searching by Teacher Code returns the correct teacher ───────────
  test("8. Searching by Teacher Code returns the correct teacher", async () => {
    const targetCode = "NZM-8K4P2X";
    const foundTeacher = {
      _id: "teacher-8k",
      name: "أستاذ مصطفى",
      email: "mustafa@test.com",
      teacherCode: targetCode,
    };

    // Mock searchTeacherByCode
    const findOneSpy = jest.spyOn(Teacher, "findOne").mockReturnValue({
      select: () => foundTeacher,
    } as any);

    // Super Admin searches with lowercase and without prefix
    const req = {
      user: { id: "admin-1", is_super_admin: true, is_admin: true, user_type: "admin" },
      query: { code: "nzm-8k4p2x" }, // Lowercase input normalization test
    } as unknown as AuthRequest;

    const res = response();
    await searchTeacherByCode(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.teacherCode).toBe(targetCode);
    expect(findOneSpy).toHaveBeenCalledWith({ teacherCode: targetCode });

    // Also test normalizer accepts short code '8K4P2X'
    expect(normalizeTeacherCode("8k4p2x")).toBe("NZM-8K4P2X");
  });

  // ─── 10. Ordinary teachers cannot access other teachers' codes ──────────
  test("9. Ordinary teachers cannot access other teachers' codes through unauthorized APIs", async () => {
    // Ordinary teacher attempts calling searchTeacherByCode
    const req = {
      user: { id: "teacher-1", is_super_admin: false, is_admin: false, user_type: "teacher" },
      query: { code: "NZM-8K4P2X" },
    } as unknown as AuthRequest;

    const res = response();
    await searchTeacherByCode(req, res);

    // Must be rejected with 403 Forbidden
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("مسموح للمدير العام فقط");

    // Ordinary teacher calling getMe receives only their own code
    const ownTeacher = {
      _id: "teacher-1",
      name: "معلم أصلي",
      email: "me@test.com",
      teacherCode: "NZM-MINE01",
    };
    jest.spyOn(Teacher, "findById").mockResolvedValue(ownTeacher as any);

    const meReq = {
      user: { id: "teacher-1", user_type: "teacher" },
    } as unknown as AuthRequest;

    const meRes = response();
    await getMe(meReq, meRes);

    expect(meRes.statusCode).toBe(200);
    expect(meRes.body.teacherCode).toBe("NZM-MINE01");
  });

  // ─── 11. Concurrent teacher creation does not produce duplicate codes ────
  test("10. Concurrent teacher creation does not produce duplicate codes", async () => {
    const assignedCodes = new Set<string>();
    const concurrency = 20;

    // Simulate 20 concurrent creation operations
    const promises = Array.from({ length: concurrency }).map(async (_, idx) => {
      // Each call uses generateUniqueTeacherCode with a mock collection that detects collisions
      return generateUniqueTeacherCode({
        collection: {
          findOne: async (filter: { teacherCode: string }) => {
            if (assignedCodes.has(filter.teacherCode)) {
              // Simulated collision
              return { _id: "existing" };
            }
            return null;
          },
        },
      } as any).then((code) => {
        assignedCodes.add(code);
        return code;
      });
    });

    const results = await Promise.all(promises);

    expect(results.length).toBe(concurrency);
    expect(new Set(results).size).toBe(concurrency);
    results.forEach((code) => {
      expect(code).toMatch(TEACHER_CODE_REGEX);
    });
  });
});
