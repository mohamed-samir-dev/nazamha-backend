/**
 * students.siblings.test.ts
 * Pure logic tests for sibling/family operations — no DB connection needed.
 */

// ─── Helpers (mirror controller logic) ───────────────────────────────────────

function extractFatherName(fullName: string): string | null {
  return fullName.trim().split(/\s+/)[1]?.toLowerCase() || null;
}

function buildFamilyName(firstStudentName: string): string {
  const parts = firstStudentName.trim().split(/\s+/);
  const fatherName = parts[1] || parts[0] || "";
  return `عائلة ${fatherName}`;
}

function generateFamilyId(): string {
  // mirrors: `FAM_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  return `FAM_${Date.now().toString(36)}_test`;
}

function validateLinkSiblings(studentIds: unknown): string | null {
  if (!Array.isArray(studentIds) || studentIds.length < 2)
    return "يجب تحديد طالبين على الأقل";
  return null;
}

function validateUnlinkSibling(studentId: unknown): string | null {
  if (!studentId || typeof studentId !== "string" || !studentId.trim())
    return "studentId مطلوب";
  return null;
}

function matchByPhone(
  students: { parent_phone?: string; sibling_family_id?: string | null }[],
  phone: string
) {
  return students.filter((s) => s.parent_phone === phone);
}

function matchByFatherName(
  students: { name: string }[],
  fatherName: string
) {
  return students.filter((s) => {
    const parts = s.name.trim().split(/\s+/);
    return parts[1]?.toLowerCase() === fatherName.toLowerCase();
  });
}

function groupByFamilyId<T extends { sibling_family_id?: string | null }>(
  students: T[]
): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  students.forEach((s) => {
    const fid = s.sibling_family_id;
    if (!fid) return;
    if (!map[fid]) map[fid] = [];
    map[fid].push(s);
  });
  return map;
}

function filterRealFamilies<T>(map: Record<string, T[]>): { familyId: string; members: T[] }[] {
  return Object.entries(map)
    .filter(([, members]) => members.length >= 2)
    .map(([familyId, members]) => ({ familyId, members }));
}

// ─── extractFatherName ────────────────────────────────────────────────────────

describe("extractFatherName", () => {
  test("يستخرج اسم الأب من الاسم الثلاثي", () => {
    expect(extractFatherName("أحمد محمد علي")).toBe("محمد");
  });

  test("يستخرج اسم الأب من الاسم الثنائي", () => {
    expect(extractFatherName("أحمد محمد")).toBe("محمد");
  });

  test("يرجع null لو اسم واحد فقط", () => {
    expect(extractFatherName("أحمد")).toBeNull();
  });

  test("يتجاهل spaces زيادة", () => {
    expect(extractFatherName("  أحمد   محمد  ")).toBe("محمد");
  });

  test("يرجع lowercase", () => {
    expect(extractFatherName("Ahmed Mohamed")).toBe("mohamed");
  });
});

// ─── buildFamilyName ──────────────────────────────────────────────────────────

describe("buildFamilyName", () => {
  test("يبني اسم العائلة من اسم الأب", () => {
    expect(buildFamilyName("أحمد محمد علي")).toBe("عائلة محمد");
  });

  test("يستخدم الاسم الأول لو اسم واحد فقط", () => {
    expect(buildFamilyName("أحمد")).toBe("عائلة أحمد");
  });
});

// ─── validateLinkSiblings ─────────────────────────────────────────────────────

describe("validateLinkSiblings", () => {
  test("يقبل طالبين أو أكثر", () => {
    expect(validateLinkSiblings(["id1", "id2"])).toBeNull();
    expect(validateLinkSiblings(["id1", "id2", "id3"])).toBeNull();
  });

  test("يرفض طالب واحد", () => {
    expect(validateLinkSiblings(["id1"])).toBe("يجب تحديد طالبين على الأقل");
  });

  test("يرفض array فاضي", () => {
    expect(validateLinkSiblings([])).toBe("يجب تحديد طالبين على الأقل");
  });

  test("يرفض null", () => {
    expect(validateLinkSiblings(null)).toBe("يجب تحديد طالبين على الأقل");
  });

  test("يرفض string", () => {
    expect(validateLinkSiblings("id1,id2")).toBe("يجب تحديد طالبين على الأقل");
  });
});

// ─── validateUnlinkSibling ────────────────────────────────────────────────────

describe("validateUnlinkSibling", () => {
  test("يقبل studentId صحيح", () => {
    expect(validateUnlinkSibling("abc123")).toBeNull();
  });

  test("يرفض string فاضي", () => {
    expect(validateUnlinkSibling("")).toBe("studentId مطلوب");
  });

  test("يرفض null", () => {
    expect(validateUnlinkSibling(null)).toBe("studentId مطلوب");
  });

  test("يرفض undefined", () => {
    expect(validateUnlinkSibling(undefined)).toBe("studentId مطلوب");
  });
});

// ─── matchByPhone ─────────────────────────────────────────────────────────────

describe("matchByPhone", () => {
  const students = [
    { name: "أحمد محمد", parent_phone: "01001234567" },
    { name: "سارة محمد", parent_phone: "01001234567" },
    { name: "علي خالد", parent_phone: "01009999999" },
  ];

  test("يجد الطلاب بنفس الرقم", () => {
    expect(matchByPhone(students, "01001234567")).toHaveLength(2);
  });

  test("يرجع فاضي لو الرقم مش موجود", () => {
    expect(matchByPhone(students, "01000000000")).toHaveLength(0);
  });
});

// ─── matchByFatherName ────────────────────────────────────────────────────────

describe("matchByFatherName", () => {
  const students = [
    { name: "أحمد محمد علي" },
    { name: "سارة محمد حسن" },
    { name: "علي خالد سعيد" },
  ];

  test("يجد الطلاب بنفس اسم الأب", () => {
    expect(matchByFatherName(students, "محمد")).toHaveLength(2);
  });

  test("يرجع فاضي لو مفيش تطابق", () => {
    expect(matchByFatherName(students, "ناصر")).toHaveLength(0);
  });

  test("case-insensitive", () => {
    expect(matchByFatherName([{ name: "Ahmed Mohamed" }], "MOHAMED")).toHaveLength(1);
  });
});

// ─── groupByFamilyId + filterRealFamilies ─────────────────────────────────────

describe("groupByFamilyId", () => {
  const students = [
    { name: "أحمد", sibling_family_id: "FAM_1" },
    { name: "سارة", sibling_family_id: "FAM_1" },
    { name: "علي", sibling_family_id: "FAM_2" },
    { name: "مريم", sibling_family_id: null },
  ];

  test("يجمع الطلاب حسب family_id", () => {
    const map = groupByFamilyId(students);
    expect(map["FAM_1"]).toHaveLength(2);
    expect(map["FAM_2"]).toHaveLength(1);
  });

  test("يتجاهل الطلاب بدون family_id", () => {
    const map = groupByFamilyId(students);
    expect(Object.keys(map)).not.toContain("null");
  });
});

describe("filterRealFamilies", () => {
  test("يرجع فقط العائلات بطالبين أو أكثر", () => {
    const map = {
      FAM_1: [{ name: "أحمد" }, { name: "سارة" }],
      FAM_2: [{ name: "علي" }],
    };
    const result = filterRealFamilies(map);
    expect(result).toHaveLength(1);
    expect(result[0].familyId).toBe("FAM_1");
  });

  test("يرجع فاضي لو مفيش عائلات حقيقية", () => {
    const map = { FAM_1: [{ name: "أحمد" }] };
    expect(filterRealFamilies(map)).toHaveLength(0);
  });
});
