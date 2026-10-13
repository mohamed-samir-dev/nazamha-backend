/**
 * students.suspension.test.ts
 * Pure logic tests for suspension operations — no DB connection needed.
 */

// ─── Helpers (mirror controller logic) ───────────────────────────────────────

function isSuspensionExpired(suspendedUntil: Date | null | undefined): boolean {
  if (!suspendedUntil) return false;
  return new Date(suspendedUntil) < new Date();
}

function buildSuspendPayload(
  suspendedUntil: string | undefined,
  reason: string | undefined
): { is_suspended: boolean; suspended_until: Date | null; suspension_reason: string | null } {
  return {
    is_suspended: true,
    suspended_until: suspendedUntil ? new Date(suspendedUntil) : null,
    suspension_reason: reason || null,
  };
}

function buildUnsuspendPayload(): {
  is_suspended: boolean;
  suspended_until: null;
  suspension_reason: null;
} {
  return { is_suspended: false, suspended_until: null, suspension_reason: null };
}

function resolveSuspensionStatus(student: {
  is_suspended?: boolean;
  suspended_until?: Date | null;
  suspension_reason?: string | null;
}): { is_suspended: boolean; suspended_until: Date | null; suspension_reason: string | null } {
  // Auto-lift if expired
  if (student.is_suspended && isSuspensionExpired(student.suspended_until)) {
    return { is_suspended: false, suspended_until: null, suspension_reason: null };
  }
  return {
    is_suspended: student.is_suspended || false,
    suspended_until: student.suspended_until || null,
    suspension_reason: student.suspension_reason || null,
  };
}

// ─── isSuspensionExpired ──────────────────────────────────────────────────────

describe("isSuspensionExpired", () => {
  test("تاريخ في الماضي = منتهي", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24); // أمس
    expect(isSuspensionExpired(past)).toBe(true);
  });

  test("تاريخ في المستقبل = لسه شغال", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24); // بكرة
    expect(isSuspensionExpired(future)).toBe(false);
  });

  test("null = مش منتهي (إيقاف دائم)", () => {
    expect(isSuspensionExpired(null)).toBe(false);
  });

  test("undefined = مش منتهي", () => {
    expect(isSuspensionExpired(undefined)).toBe(false);
  });
});

// ─── buildSuspendPayload ──────────────────────────────────────────────────────

describe("buildSuspendPayload", () => {
  test("يبني payload صحيح مع تاريخ وسبب", () => {
    const result = buildSuspendPayload("2025-12-31", "سلوك سيء");
    expect(result.is_suspended).toBe(true);
    expect(result.suspended_until).toBeInstanceOf(Date);
    expect(result.suspension_reason).toBe("سلوك سيء");
  });

  test("suspended_until = null لو مش موجود (إيقاف دائم)", () => {
    const result = buildSuspendPayload(undefined, undefined);
    expect(result.is_suspended).toBe(true);
    expect(result.suspended_until).toBeNull();
    expect(result.suspension_reason).toBeNull();
  });

  test("suspension_reason = null لو مش موجود", () => {
    const result = buildSuspendPayload("2025-12-31", undefined);
    expect(result.suspension_reason).toBeNull();
  });

  test("يحول التاريخ لـ Date object", () => {
    const result = buildSuspendPayload("2025-06-15", "سبب");
    expect(result.suspended_until?.getFullYear()).toBe(2025);
    expect(result.suspended_until?.getMonth()).toBe(5); // June = 5
  });
});

// ─── buildUnsuspendPayload ────────────────────────────────────────────────────

describe("buildUnsuspendPayload", () => {
  test("يرجع payload صحيح لرفع الإيقاف", () => {
    expect(buildUnsuspendPayload()).toEqual({
      is_suspended: false,
      suspended_until: null,
      suspension_reason: null,
    });
  });
});

// ─── resolveSuspensionStatus ──────────────────────────────────────────────────

describe("resolveSuspensionStatus", () => {
  test("طالب موقوف بتاريخ مستقبلي — يرجع موقوف", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const result = resolveSuspensionStatus({
      is_suspended: true,
      suspended_until: future,
      suspension_reason: "سبب",
    });
    expect(result.is_suspended).toBe(true);
    expect(result.suspension_reason).toBe("سبب");
  });

  test("طالب موقوف بتاريخ منتهي — يُرفع تلقائياً", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const result = resolveSuspensionStatus({
      is_suspended: true,
      suspended_until: past,
      suspension_reason: "سبب",
    });
    expect(result.is_suspended).toBe(false);
    expect(result.suspended_until).toBeNull();
    expect(result.suspension_reason).toBeNull();
  });

  test("طالب موقوف بدون تاريخ (دائم) — يبقى موقوف", () => {
    const result = resolveSuspensionStatus({
      is_suspended: true,
      suspended_until: null,
      suspension_reason: "سلوك",
    });
    expect(result.is_suspended).toBe(true);
  });

  test("طالب مش موقوف — يرجع false", () => {
    const result = resolveSuspensionStatus({ is_suspended: false });
    expect(result.is_suspended).toBe(false);
    expect(result.suspended_until).toBeNull();
    expect(result.suspension_reason).toBeNull();
  });

  test("طالب بدون حقل is_suspended — يرجع false", () => {
    const result = resolveSuspensionStatus({});
    expect(result.is_suspended).toBe(false);
  });
});
