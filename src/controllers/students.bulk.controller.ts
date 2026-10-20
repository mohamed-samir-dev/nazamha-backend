import { atomicController } from "../services/atomicController";
import { Grade } from "../models/Grade";
import { StudentMembership } from "../models/StudentMembership";
import { getTodayInTimezone } from "../utils/timezoneUtils";
import { validStudentDiscounts } from "../utils/ownedReferences";
import { Response } from "express";
import mongoose from "mongoose";
import { Student } from "../models/Student";
import { Teacher } from "../models/Teacher";
import { Group } from "../models/Group";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { AuthRequest, canAccessTeacher } from "../middleware/auth";
import { calcDiscount, allocateStudentCodes, resolveOrCreateCenterStudent, normalizeName, normalizePhone } from "./students.helpers";
import { validStudentName } from "../utils/studentName";

interface BulkStudentInput {
  name: string;
  grade_id?: string | null;
  group_id?: string | null;
  parent_phone?: string;
  custom_monthly_price?: number | null;
  subscription_start_month?: number;
  subscription_start_year?: number;
}

function resolveMonthYears(
  activeMonths: number[],
  startMonth: number,
  startYear: number
): { month: number; year: number; status: "due" | "not_due" }[] {
  if (!activeMonths.length) return [];
  const sorted = [...activeMonths].sort((a, b) => a - b);
  const startDate = startYear * 100 + startMonth;
  const anchorIdx = sorted.findIndex((m) => m >= startMonth);
  const anchor = anchorIdx === -1 ? 0 : anchorIdx;
  return sorted.map((m, i) => {
    const year = i >= anchor ? startYear : startYear + 1;
    const status: "due" | "not_due" = year * 100 + m >= startDate ? "due" : "not_due";
    return { month: m, year, status };
  });
}

export const bulkAddStudents = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = req.user!.user_type === "teacher" ? req.user!.id : req.body.teacher_id;
  if (!canAccessTeacher(req, teacherId)) { res.status(403).json({ message: "غير مصرح" }); return; }
  const students: BulkStudentInput[] = req.body.students;

  if (!Array.isArray(students) || students.length === 0) {
    res.status(400).json({ message: "يجب إرسال مصفوفة طلاب غير فارغة" });
    return;
  }
  if (students.length > 1000) {
    res.status(400).json({ message: "الحد الأقصى 1000 طالب في الطلب الواحد" });
    return;
  }

  for (const student of students) {
    if (!validStudentDiscounts(student as unknown as Record<string, unknown>)) { res.status(400).json({ message: "نسبة الخصم يجب أن تكون رقمًا بين 0 و100" }); return; }
    if (!validStudentName(student.name)) { res.status(400).json({ message: "اسم كل طالب يجب أن يكون حروفًا واسمين على الأقل" }); return; }
  }
  // ── 1. جيب Teacher + Groups بـ query واحد لكل منهم ──────────────────────
  const teacher = await Teacher.findById(teacherId).lean();
  if (!teacher) { res.status(404).json({ message: "المعلم غير موجود" }); return; }

  const centerId: string | null = (teacher as any).center_id ? String((teacher as any).center_id) : null;

  const activeMonths: number[] = (teacher as any).academic_year?.active_months ?? [9,10,11,12,1,2,3,4,5];
  const teacherPrice: number = (teacher as any).monthly_price || 0;

  // جيب كل المجموعات المطلوبة بـ query واحد
  const groupIds = [...new Set(students.map((s) => s.group_id).filter(Boolean))] as string[];
  const groupDocs = groupIds.length
    ? await Group.find({ _id: { $in: groupIds }, teacher_id: teacherId }).lean()
    : [];
  const groupMap = new Map(groupDocs.map((g) => [String(g._id), g]));

  const gradeIds = [...new Set(students.map(s=>s.grade_id).filter(Boolean))];
  const grades = await Grade.find({_id:{$in:gradeIds},teacher_id:teacherId}).select("_id").lean();
  const validGrades = new Set(grades.map(g=>String(g._id)));
  for (const student of students) {
    const group = student.group_id ? groupMap.get(student.group_id) : null;
    if ((student.grade_id && !validGrades.has(student.grade_id)) || (student.group_id && (!group || String(group.grade_id)!==String(student.grade_id)))) {
      res.status(400).json({message:"المجموعة أو الصف لا ينتمي للمدرس أو لا يتوافق مع الطالب"}); return;
    }
  }

  // ── 2. جيب الطلاب الموجودين بنفس الأرقام لكشف العائلات (query واحد) ────
  // ── 1b. Pre-resolve CenterStudent identities (لو المدرس في سنتر) ─────────
  // نبني map: "normalizedName|normalizedPhone" → { centerStudentId, centerStudentCode }
  // بـ query واحد بدل ما نعمل DB call لكل طالب
  const centerStudentMap = new Map<string, { centerStudentId: string; centerStudentCode: string }>();
  if (centerId) {
    const { CenterStudent } = await import("../models/CenterStudent");
    // جيب كل الـ CenterStudents الموجودين في السنتر ده بـ query واحد
    const phones = [...new Set(students.map((s) => s.parent_phone).filter(Boolean))] as string[];
    const normalizedPhones = phones.map(normalizePhone);
    const existingCS = normalizedPhones.length
      ? await CenterStudent.find({ center_id: centerId, parent_phone: { $in: normalizedPhones } }).lean()
      : [];
    for (const cs of existingCS) {
      const key = `${normalizeName((cs as any).name)}|${(cs as any).parent_phone}`;
      centerStudentMap.set(key, {
        centerStudentId: String((cs as any)._id),
        centerStudentCode: (cs as any).center_student_code,
      });
    }
  }
  const phones = [...new Set(students.map((s) => s.parent_phone).filter(Boolean))] as string[];
  const existingByPhone = phones.length
    ? await Student.find({ teacher_id: teacherId, parent_phone: { $in: phones } })
        .lean()
        .select("parent_phone sibling_family_id sibling_family_name name family_discount_percent family_discount_reason family_book_discount_percent family_book_discount_reason")
    : [];

  // phone -> { familyId, familyName }
  const familyByPhone = new Map<string, { id: string; name: string; discount?: number | null; bookDiscount?: number | null; reason?: string | null; bookReason?: string | null } | null>();
  for (const s of existingByPhone) {
    const phone = (s as any).parent_phone;
    if ((s as any).sibling_family_id && !familyByPhone.has(phone)) {
      familyByPhone.set(phone, {
        id: (s as any).sibling_family_id,
        name: (s as any).sibling_family_name || "",
        discount: s.family_discount_percent, bookDiscount: s.family_book_discount_percent, reason: s.family_discount_reason, bookReason: s.family_book_discount_reason,
      });
    }
  }

  // ── 3. بناء documents الطلاب ─────────────────────────────────────────────
  const now = new Date();
  const [currentYear, currentMonth] = getTodayInTimezone().split("-").map(Number);
  const docsToInsert: object[] = [];
  const reservedCodes = new Map<string, string[]>();
  const requestedCounts = new Map<string, number>();
  for (const student of students) if (student.group_id) requestedCounts.set(student.group_id, (requestedCounts.get(student.group_id) || 0) + 1);
  for (const [groupId, count] of requestedCounts) {
    const prefix = groupMap.get(groupId)?.code;
    if (prefix) reservedCodes.set(groupId, await allocateStudentCodes(teacherId, groupId, prefix, count));
  }


  for (const s of students) {
    const startMonth = s.subscription_start_month || currentMonth;
    const startYear  = s.subscription_start_year  || currentYear;

    // حساب السعر
    let basePrice = 0;
    if (s.custom_monthly_price && s.custom_monthly_price > 0) {
      basePrice = s.custom_monthly_price;
    } else if (s.group_id) {
      const g = groupMap.get(s.group_id);
      basePrice = (g as any)?.monthly_price || teacherPrice;
    } else {
      basePrice = teacherPrice;
    }

    // توليد الكود
    let code: string | undefined;
    if (s.group_id) {
      const g = groupMap.get(s.group_id);
      const groupCode = (g as any)?.code;
      if (groupCode) {
        code = reservedCodes.get(s.group_id)!.shift();
      }
    }

    // العائلة
    let sibling_family_id: string | null = null;
    let sibling_family_name: string | null = null;
    if (s.parent_phone) {
      const fam = familyByPhone.get(s.parent_phone);
      if (fam) {
        sibling_family_id = fam.id;
        sibling_family_name = fam.name;
      }
    }

    const _id = new mongoose.Types.ObjectId();

    // ── Center Student Identity ──────────────────────────────────────────────
    let centerStudentCode: string | null = null;
    let centerStudentId: string | null = null;
    if (centerId && s.parent_phone) {
      const key = `${normalizeName(s.name)}|${normalizePhone(s.parent_phone)}`;
      const cached = centerStudentMap.get(key);
      if (cached) {
        centerStudentCode = cached.centerStudentCode;
        centerStudentId   = cached.centerStudentId;
      } else {
        const resolved = await resolveOrCreateCenterStudent(centerId, s.name, s.parent_phone);
        centerStudentCode = resolved.centerStudentCode;
        centerStudentId = String(resolved.centerStudentId);
        centerStudentMap.set(key, { centerStudentCode, centerStudentId });
      }
    }

    if (centerId && !s.parent_phone) {
      const resolved = await resolveOrCreateCenterStudent(centerId, s.name, "");
      centerStudentCode = resolved.centerStudentCode; centerStudentId = String(resolved.centerStudentId);
    }
    docsToInsert.push({
      _id,
      name: s.name.trim(),
      teacher_id: new mongoose.Types.ObjectId(teacherId),
      grade_id: s.grade_id ? new mongoose.Types.ObjectId(s.grade_id) : null,
      group_id: s.group_id ? new mongoose.Types.ObjectId(s.group_id) : null,
      group_join_date: s.group_id ? getTodayInTimezone() : null,
      parent_phone: s.parent_phone || null,
      custom_monthly_price: s.custom_monthly_price || null,
      subscription_start_month: startMonth,
      subscription_start_year: startYear,
      sibling_family_id,
      sibling_family_name,
      family_discount_percent: familyByPhone.get(s.parent_phone || "")?.discount ?? null,
      family_discount_reason: familyByPhone.get(s.parent_phone || "")?.reason ?? null,
      family_book_discount_percent: familyByPhone.get(s.parent_phone || "")?.bookDiscount ?? null,
      family_book_discount_reason: familyByPhone.get(s.parent_phone || "")?.bookReason ?? null,
      code: code || null,
      center_student_code: centerStudentCode,
      center_student_id: centerStudentId ? new mongoose.Types.ObjectId(centerStudentId) : null,
      months: Array(12).fill(false),
      received_books: [],
      is_suspended: false,
      created_at: now,
      updated_at: now,
      // حفظ السعر للاشتراكات
      _basePrice: basePrice,
      _startMonth: startMonth,
      _startYear: startYear,
    });
  }

  // ── 4. insertMany مرة واحدة ───────────────────────────────────────────────
  let inserted: InstanceType<typeof Student>[] = [];
  inserted = await Student.insertMany(docsToInsert, { ordered: true });

  // ── 5. بناء كل الاشتراكات بـ bulkWrite واحد ──────────────────────────────
  const subOps: object[] = [];

  for (let i = 0; i < docsToInsert.length; i++) {
    const doc = docsToInsert[i] as any;
    const studentId = doc._id;
    const basePrice: number = doc._basePrice || 0;
    const startMonth: number = doc._startMonth;
    const startYear: number  = doc._startYear;

    const pairs = (teacher as any).academic_year?.active_month_years as {month:number;year:number}[] | undefined;
    const resolved = pairs?.length ? pairs.filter(p=>p.year*100+p.month>=startYear*100+startMonth).map(p=>({...p,status:"due" as const})) : resolveMonthYears(activeMonths, startMonth, startYear);
    const price = calcDiscount(basePrice, doc.family_discount_percent, 0);
    for (const { month, year, status } of resolved) {
      subOps.push({
        insertOne: {
          document: {
            student_id: studentId,
            teacher_id: new mongoose.Types.ObjectId(teacherId),
            month,
            year,
            status,
            amount: price.amount,
            discount: price.discount,
          },
        },
      });
    }
  }

  if (subOps.length > 0) {
    await MonthlySubscription.bulkWrite(subOps as any[], { ordered: true });
  }

  const memberships = inserted.filter(student=>student.group_id).map(student=>({student_id:student._id,teacher_id:teacherId,group_id:student.group_id,grade_id:student.grade_id,starts_on:getTodayInTimezone(),ends_on:null,actor_id:req.user!.actor_id || req.user!.id,reason:"bulk enrollment"}));
  if(memberships.length) await StudentMembership.insertMany(memberships,{ordered:true});
  // ── 6. إرجاع الطلاب المضافين (بدون الحقول المؤقتة) ───────────────────────
  const result = inserted.map((s) => {
    const obj = s.toJSON();
    return obj;
  });

  res.status(201).json({
    inserted: result.length,
    students: result,
  });
});
