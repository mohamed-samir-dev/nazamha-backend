import { nextSequence, reserveSequence } from "../services/counters";
import { Group } from "../models/Group";
import { Teacher } from "../models/Teacher";
import { Center } from "../models/Center";
import { Student } from "../models/Student";
import { CenterStudent } from "../models/CenterStudent";
import { MonthlySubscription } from "../models/MonthlySubscription";
import mongoose from "mongoose";

/** حساب كود الطالب بناءً على كودات المجموعة الموجودة */
export function buildStudentCode(groupCode: string, existingCodes: string[]): string {
  let maxSeq = 0;
  existingCodes.forEach((c) => {
    if (c.startsWith(`${groupCode}-`)) {
      const num = parseInt(c.substring(groupCode.length + 1), 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });
  return `${groupCode}-${String(maxSeq + 1).padStart(4, "0")}`;
}

/**
 * استخراج 3 حروف prefix من اسم السنتر.
 * مثال: "مركز النور" → "NOR" | "Star Academy" → "STA"
 * - لو الاسم إنجليزي: أول 3 حروف من الكلمات
 * - لو الاسم عربي: نستخدم transliteration بسيط أو fallback لـ CTR
 */
function deriveCenterPrefix(centerName: string): string {
  // جرب الحروف الإنجليزية أولاً
  const latinLetters = centerName.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (latinLetters.length >= 3) return latinLetters.slice(0, 3);

  // اسم عربي — خد أول حرف من كل كلمة وحوله لـ transliteration بسيط
  const arabicMap: Record<string, string> = {
    "م": "M", "ن": "N", "ر": "R", "ك": "K", "س": "S", "ع": "A", "ل": "L",
    "ه": "H", "و": "W", "ي": "Y", "ا": "A", "ب": "B", "ت": "T", "ث": "T",
    "ج": "G", "ح": "H", "خ": "K", "د": "D", "ذ": "D", "ز": "Z", "ش": "S",
    "ص": "S", "ض": "D", "ط": "T", "ظ": "Z", "ف": "F", "ق": "Q", "ء": "A",
    "ة": "A", "ى": "A", "إ": "A", "أ": "A", "آ": "A", "ئ": "Y", "ؤ": "W",
  };
  const words = centerName.trim().split(/\s+/);
  let prefix = "";
  for (const word of words) {
    const firstChar = word[0];
    prefix += arabicMap[firstChar] || firstChar.toUpperCase().replace(/[^A-Z]/g, "") || "X";
    if (prefix.length >= 3) break;
  }
  // لو لسه أقل من 3 حروف، كمّل من الحروف المتاحة
  if (prefix.length < 3) {
    for (const char of centerName) {
      const mapped = arabicMap[char] || char.toUpperCase().replace(/[^A-Z]/g, "");
      if (mapped) prefix += mapped;
      if (prefix.length >= 3) break;
    }
  }
  return (prefix.slice(0, 3).padEnd(3, "X"));
}

/** تنسيق الرقم التسلسلي: 0001, 0002, ..., 9999, 10000, ... */
function formatSeq(seq: number): string {
  return seq <= 9999 ? String(seq).padStart(4, "0") : String(seq);
}

/**
 * توليد center_student_code بالـ format الجديد: ABC-0001
 * يستخدم auto-increment per center بدل random.
 * الـ seq محفوظ في CenterStudent.seq ويُحسب بـ $max + 1.
 */
async function generateSequentialCenterCode(
  centerId: string,
  prefix: string
): Promise<{ code: string; seq: number }> {
  // جيب أعلى seq موجود لهذا السنتر
  const nextSeq = await nextSequence("center:"+centerId, async()=> {
    const last = await CenterStudent.findOne({center_id:centerId}).sort({seq:-1}).select("seq").lean();
    return last?.seq || 0;
  });
  return { code: `${prefix}-${formatSeq(nextSeq)}`, seq: nextSeq };
}

/** Normalize اسم الطالب: trim + collapse whitespace */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Normalize رقم الهاتف: أرقام فقط */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * البحث عن CenterStudent موجود أو إنشاء واحد جديد.
 * يُستخدم عند إضافة طالب لمدرس داخل سنتر.
 *
 * Race condition protection:
 * - نحاول findOne أولاً (الحالة الشائعة — لا write).
 * - لو مش موجود، نستخدم findOneAndUpdate مع upsert: true + setOnInsert
 *   بحيث لو حصل race condition وتم إنشاء record في نفس اللحظة،
 *   الـ unique index على { center_id, center_student_code } يمنع duplicate
 *   والـ findOneAndUpdate يرجع الـ record الموجود بدل ما يرمي error.
 *
 * @returns { centerStudentId, centerStudentCode }
 */
export async function resolveOrCreateCenterStudent(
  centerId: string,
  name: string,
  parentPhone: string
): Promise<{ centerStudentId: mongoose.Types.ObjectId; centerStudentCode: string }> {
  const normalizedName  = normalizeName(name);
  const normalizedPhone = normalizePhone(parentPhone);

  const identityFilter = normalizedPhone
    ? { center_id: centerId, name: normalizedName, parent_phone: normalizedPhone }
    : { _id: new mongoose.Types.ObjectId(), center_id: centerId };

  // ── 1. البحث أولاً (fast path — no write) ────────────────────────────────
  const existing = await CenterStudent.findOne(identityFilter).lean();

  if (existing) {
    return {
      centerStudentId: existing._id as mongoose.Types.ObjectId,
      centerStudentCode: existing.center_student_code,
    };
  }

  // ── 2. جيب اسم السنتر لاستخراج الـ prefix ────────────────────────────────
  const center = await Center.findById(centerId).select("name").lean() as any;
  const prefix = deriveCenterPrefix(center?.name || "CTR");

  // ── 3. إنشاء جديد مع حماية من race condition ─────────────────────────────
  // نستخدم findOneAndUpdate مع upsert على { center_id, name, parent_phone }.
  // لو حصل race condition على نفس الطالب → يرجع الموجود.
  // لو حصل race condition على نفس الـ seq → unique index على { center_id, center_student_code } يمنعه → retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { code: newCode, seq: newSeq } = await generateSequentialCenterCode(centerId, prefix);
    try {
      const doc = await CenterStudent.findOneAndUpdate(
        identityFilter,
        { $setOnInsert: { center_id: centerId, name: normalizedName, parent_phone: normalizedPhone, center_student_code: newCode, center_prefix: prefix, seq: newSeq } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return {
        centerStudentId: doc._id as mongoose.Types.ObjectId,
        centerStudentCode: doc.center_student_code,
      };
    } catch (err: any) {
      if (err?.code === 11000 && attempt < 4) continue; // seq collision → retry
      // race على name+phone → ارجع الموجود
      const fallback = await CenterStudent.findOne(identityFilter).lean();
      if (fallback) return { centerStudentId: fallback._id as mongoose.Types.ObjectId, centerStudentCode: fallback.center_student_code };
      throw err;
    }
  }
  throw new Error("[resolveOrCreateCenterStudent] failed after 5 attempts");
}

/**
 * @deprecated استخدم resolveOrCreateCenterStudent بدلاً منها.
 */
export async function generateCenterStudentCode(centerId: string): Promise<string> {
  const center = await Center.findById(centerId).select("name").lean() as any;
  const prefix = deriveCenterPrefix(center?.name || "CTR");
  const { code } = await generateSequentialCenterCode(centerId, prefix);
  return code;
}

/**
 * البحث عن طلاب محتملين داخل نفس السنتر بنفس parent_phone + grade_id.
 * يُستخدم لعرض suggestion للمستخدم — القرار النهائي للمستخدم.
 */
export async function findCenterStudentSuggestions(
  centerId: string,
  parentPhone: string,
  gradeId: string | null | undefined
): Promise<{ student_id: string; name: string; center_student_code: string; teacher_name: string; group_name: string | null }[]> {
  if (!parentPhone) return [];

  const teachers = await Teacher.find({ center_id: centerId, deleted_at: null }).select("_id name").lean();
  const teacherIds = teachers.map((t: any) => t._id);
  const teacherNameMap = new Map(teachers.map((t: any) => [String(t._id), t.name as string]));

  const filter: Record<string, unknown> = {
    teacher_id: { $in: teacherIds },
    parent_phone: parentPhone,
    center_student_code: { $ne: null },
  };
  if (gradeId) filter.grade_id = gradeId;

  const students = await Student.find(filter)
    .select("_id name center_student_code teacher_id group_id")
    .lean() as any[];

  if (!students.length) return [];

  // جيب أسماء المجموعات بـ query واحد
  const groupIds = students.map((s: any) => s.group_id).filter(Boolean);
  const groups = groupIds.length
    ? await Group.find({ _id: { $in: groupIds } }).select("_id name").lean()
    : [];
  const groupNameMap = new Map((groups as any[]).map((g: any) => [String(g._id), g.name as string]));

  // deduplicate by center_student_code — نعرض record واحد لكل هوية
  const seen = new Set<string>();
  const result: { student_id: string; name: string; center_student_code: string; teacher_name: string; group_name: string | null }[] = [];
  for (const s of students) {
    const csc = s.center_student_code as string;
    if (seen.has(csc)) continue;
    seen.add(csc);
    result.push({
      student_id: String(s._id),
      name: s.name,
      center_student_code: csc,
      teacher_name: teacherNameMap.get(String(s.teacher_id)) ?? "",
      group_name: s.group_id ? (groupNameMap.get(String(s.group_id)) ?? null) : null,
    });
  }
  return result;
}

/** حساب السعر الأساسي للطالب (custom → group → teacher) */
export async function resolveBasePrice(
  customPrice: number | null | undefined,
  groupId: mongoose.Types.ObjectId | null | undefined,
  teacherId: string
): Promise<number> {
  if (customPrice != null && customPrice > 0) return customPrice;

  if (groupId) {
    const group = await Group.findById(groupId).lean();
    const gp = (group as any)?.monthly_price;
    if (gp != null && gp > 0) return gp;
  }

  const teacher = await Teacher.findById(teacherId).lean();
  return (teacher as any)?.monthly_price || 0;
}

/** حساب مبلغ الخصم بعد تحديد النسبة الفعّالة (عائلي يطغى على فردي) */
export function calcDiscount(
  basePrice: number,
  familyPct: number | null | undefined,
  individualPct: number | null | undefined
): { amount: number; discount: number } {
  const family = familyPct ?? 0;
  const individual = Number(individualPct) || 0;
  const activePct = family > 0 ? family : individual;
  if (activePct <= 0) return { amount: basePrice, discount: 0 };
  const netPrice = Math.round(basePrice * (1 - activePct / 100));
  return { amount: basePrice, discount: basePrice - netPrice };
}

/** مزامنة مبالغ الاشتراكات المستحقة لطالب واحد */
export async function syncDueSubscriptions(
  studentId: mongoose.Types.ObjectId | string,
  teacherId: string,
  basePrice: number,
  familyPct: number | null | undefined,
  individualPct: number | null | undefined
): Promise<void> {
  const { amount, discount } = calcDiscount(basePrice, familyPct, individualPct);
  await MonthlySubscription.updateMany(
    { student_id: studentId, teacher_id: teacherId, status: { $in: ["due", "not_due"] } },
    { amount, discount }
  );
}

export async function allocateStudentCode(teacherId:string, groupId:string, prefix:string):Promise<string>{
 return (await allocateStudentCodes(teacherId,groupId,prefix,1))[0];
}
export async function allocateStudentCodes(teacherId:string, groupId:string, prefix:string,count:number):Promise<string[]>{
 const seq=await reserveSequence("student:"+teacherId+":"+groupId,count,async()=>{
  const students=await Student.find({teacher_id:teacherId,group_id:groupId}).select("code").lean();
  return Math.max(0,...students.map(s=>Number((s.code||"").match(/-(\d+)$/)?.[1])||0));
 });
 return Array.from({length:count},(_,offset)=>prefix+"-"+String(seq+offset).padStart(4,"0"));
}
