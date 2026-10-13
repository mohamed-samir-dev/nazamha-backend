/**
 * students.crud.test.ts
 * Pure logic tests for CRUD operations — no DB connection needed.
 */

// ─── Helpers (mirror controller logic) ───────────────────────────────────────

function validateStudentName(name: unknown): string | null {
  if (!name || typeof name !== "string" || !name.trim()) return "اسم الطالب مطلوب";
  return null;
}

function buildStudentCode(groupCode: string, existingCodes: string[]): string {
  let maxSeq = 0;
  existingCodes.forEach((c) => {
    if (c.startsWith(`${groupCode}-`)) {
      const num = parseInt(c.substring(groupCode.length + 1), 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });
  return `${groupCode}-${String(maxSeq + 1).padStart(4, "0")}`;
}

function stripProtectedFields(body: Record<string, unknown>): Record<string, unknown> {
  const { teacher_id, _id, id, created_at, updated_at, ...safe } = body;
  return safe;
}

function resolveStartDate(
  startMonth: unknown,
  startYear: unknown,
  now: Date
): { month: number; year: number } {
  return {
    month: Number(startMonth) || now.getMonth() + 1,
    year: Number(startYear) || now.getFullYear(),
  };
}

// ─── validateStudentName ──────────────────────────────────────────────────────

describe("validateStudentName", () => {
  test("يقبل اسم صحيح", () => {
    expect(validateStudentName("أحمد محمد")).toBeNull();
  });

  test("يرفض اسم فاضي", () => {
    expect(validateStudentName("")).toBe("اسم الطالب مطلوب");
  });

  test("يرفض spaces فقط", () => {
    expect(validateStudentName("   ")).toBe("اسم الطالب مطلوب");
  });

  test("يرفض null", () => {
    expect(validateStudentName(null)).toBe("اسم الطالب مطلوب");
  });

  test("يرفض undefined", () => {
    expect(validateStudentName(undefined)).toBe("اسم الطالب مطلوب");
  });
});

// ─── buildStudentCode ─────────────────────────────────────────────────────────

describe("buildStudentCode", () => {
  test("أول طالب في المجموعة يبدأ من 0001", () => {
    expect(buildStudentCode("A", [])).toBe("A-0001");
  });

  test("يكمل من بعد أعلى رقم موجود", () => {
    expect(buildStudentCode("A", ["A-0001", "A-0002", "A-0003"])).toBe("A-0004");
  });

  test("يتجاهل كودات مجموعات تانية", () => {
    expect(buildStudentCode("B", ["A-0001", "A-0002"])).toBe("B-0001");
  });

  test("يتعامل مع فجوات في التسلسل", () => {
    expect(buildStudentCode("A", ["A-0001", "A-0005"])).toBe("A-0006");
  });

  test("يدعم group code متعدد الأحرف", () => {
    expect(buildStudentCode("GRP1", ["GRP1-0009"])).toBe("GRP1-0010");
  });

  test("يتجاهل كودات بصيغة غلط", () => {
    expect(buildStudentCode("A", ["A-XXXX", "A-0003"])).toBe("A-0004");
  });
});

// ─── stripProtectedFields ─────────────────────────────────────────────────────

describe("stripProtectedFields", () => {
  test("يشيل الحقول المحمية", () => {
    const result = stripProtectedFields({
      teacher_id: "t1",
      _id: "s1",
      id: "s1",
      created_at: new Date(),
      updated_at: new Date(),
      name: "أحمد",
      discount_value: 10,
    });
    expect(result).not.toHaveProperty("teacher_id");
    expect(result).not.toHaveProperty("_id");
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("created_at");
    expect(result).not.toHaveProperty("updated_at");
  });

  test("يحتفظ بالحقول المسموح بتعديلها", () => {
    const result = stripProtectedFields({ teacher_id: "t1", name: "أحمد", discount_value: 10 });
    expect(result).toEqual({ name: "أحمد", discount_value: 10 });
  });

  test("يرجع object فاضي لو كل الحقول محمية", () => {
    const result = stripProtectedFields({ teacher_id: "t1", _id: "s1" });
    expect(result).toEqual({});
  });
});

// ─── resolveStartDate ─────────────────────────────────────────────────────────

describe("resolveStartDate", () => {
  const now = new Date(2024, 8, 1); // سبتمبر 2024

  test("يستخدم القيم المرسلة لو موجودة", () => {
    expect(resolveStartDate(11, 2024, now)).toEqual({ month: 11, year: 2024 });
  });

  test("يرجع للـ now لو startMonth مش موجود", () => {
    expect(resolveStartDate(null, null, now)).toEqual({ month: 9, year: 2024 });
  });

  test("يتعامل مع string numbers", () => {
    expect(resolveStartDate("10", "2025", now)).toEqual({ month: 10, year: 2025 });
  });

  test("يرجع للـ now لو القيم 0", () => {
    expect(resolveStartDate(0, 0, now)).toEqual({ month: 9, year: 2024 });
  });
});
