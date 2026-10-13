import { StudentMembership } from "../models/StudentMembership";
import { atomicController, series } from "../services/atomicController";
import { findScannedStudent } from "../utils/studentScan";
import { validateOwnedReferences, groupMatchesGrade, validStudentDiscounts } from "../utils/ownedReferences";
import { Response } from "express";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { ExamGrade } from "../models/Exam";
import { AuthRequest, getAdminTeacherFilter, teacherFilter } from "../middleware/auth";
import { generateSubscriptionsForStudent } from "../services/subscriptionLifecycle";
import { allocateStudentCode, buildStudentCode, resolveBasePrice, syncDueSubscriptions, resolveOrCreateCenterStudent } from "./students.helpers";
import { Teacher } from "../models/Teacher";
import { getTodayInTimezone } from "../utils/timezoneUtils";

import mongoose from "mongoose";

// الحقول المسموح للـ client بتعديلها فقط
const STUDENT_UPDATABLE_FIELDS = new Set([
  "name", "grade_id", "group_id", "parent_phone", "parent_job",
  "student_email", "notes", "discount_value", "discount_reason",
  "apply_discount_to_books", "book_discount_value", "custom_monthly_price",
  "received_books", "months",
]);

/** حذف الطالب وكل بياناته المرتبطة.
 *  - MonthlySubscription: تُحذف كلها (due + not_due) لأن الطالب نفسه اتحذف.
 *  - AttendanceRecord: تُحذف — سجل حضور بدون طالب لا معنى له.
 *  - ExamGrade: تُحذف — درجات بدون طالب لا معنى لها.
 *  - BookSale: لا تُحذف — سجل مالي تاريخي مرتبط بالكتاب والمدرس.
 */
async function deleteStudentCascade(studentId:string, centerStudentId?:string|null):Promise<void>{
 await MonthlySubscription.deleteMany({student_id:studentId,status:{$in:["due","not_due"]}});
 await AttendanceRecord.deleteMany({student_id:studentId});
 await ExamGrade.deleteMany({student_id:studentId});
 await StudentMembership.deleteMany({student_id:studentId});
 if(centerStudentId && !await Student.exists({center_student_id:centerStudentId})){
  const {CenterStudent}=await import("../models/CenterStudent");await CenterStudent.deleteOne({_id:centerStudentId});
 }
}

// الحقول الافتراضية للـ listing — تشمل كل ما يحتاجه StudentTableRow
const LISTING_FIELDS = [
  "name", "code", "center_student_code", "grade_id", "group_id", "parent_phone",
  "is_suspended", "suspended_until", "suspension_reason",
  "sibling_family_id", "sibling_family_name",
  "family_discount_percent", "discount_value", "custom_monthly_price",
  "received_books", "subscription_start_month", "subscription_start_year",
  "teacher_id",
].join(" ");

export const getStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const fields = typeof req.query.fields === "string" ? req.query.fields.replace(/,/g, " ") : undefined;
    const pageParam = req.query.page;
    const limitParam = req.query.limit;

    // If no pagination params → return all (backward compat for print/export)
    if (!pageParam && !limitParam) {
      const students = await Student.find(teacherFilter(req))
        .select(fields || LISTING_FIELDS)
        .sort({ code: 1 })
        .lean();
      res.json(students.map((s: any) => {
        const { _id, __v, teacher_id, group_id, grade_id, ...rest } = s;
        return {
          id: String(_id),
          teacher_id: teacher_id ? String(teacher_id) : undefined,
          group_id: group_id ? String(group_id) : null,
          grade_id: grade_id ? String(grade_id) : null,
          ...rest,
        };
      }));
      return;
    }

    const MAX_LIMIT = 100;
    const page = Math.max(1, parseInt(pageParam as string) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam as string) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...teacherFilter(req) };

    if (req.query.search) {
      const q = String(req.query.search).trim();
      const isCode = /^[A-Za-z0-9\-]+$/.test(q);
      if (isCode) {
        // بحث بالكود — regex على code بس
        filter.code = { $regex: q, $options: "i" };
      } else {
        // بحث بالاسم — $text index أسرع بكتير من $regex
        filter.$text = { $search: q };
      }
    }
    if (req.query.group_id) {
      filter.group_id = req.query.group_id === "none" ? null : req.query.group_id;
    }
    if (req.query.grade_id && req.query.grade_id !== "all") {
      filter.grade_id = req.query.grade_id;
    }

    const [students, total] = await Promise.all([
      Student.find(filter).select(fields || LISTING_FIELDS).sort({ code: 1 }).skip(skip).limit(limit).lean(),
      Student.countDocuments(filter),
    ]);

    const mapped = students.map((s: any) => {
      const { _id, __v, teacher_id, group_id, grade_id, ...rest } = s;
      return {
        id: String(_id),
        teacher_id: teacher_id ? String(teacher_id) : undefined,
        group_id: group_id ? String(group_id) : null,
        grade_id: grade_id ? String(grade_id) : null,
        ...rest,
      };
    });

    res.json({ students: mapped, total, page, limit });
  } catch (error: any) {
    if (error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء جلب الطلاب" });
  }
};

export const getStudentById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const student = await Student.findOne({ _id: req.params.id, ...teacherFilter(req) });
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
    res.json(student);
  } catch (error: any) {
    if (error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء جلب الطالب" });
  }
};

export const getStudentMemberships = async (req: AuthRequest, res: Response): Promise<void> => {
  const student = await Student.findOne({ _id: req.params.id, ...teacherFilter(req) }).select("teacher_id").lean();
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
  const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1)));
  const filter = { student_id: student._id, teacher_id: student.teacher_id };
  const [items, total] = await Promise.all([
    StudentMembership.find(filter).sort({ created_at: -1, _id: -1 }).skip((page - 1) * 25).limit(25).populate("group_id", "name").lean(),
    StudentMembership.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit: 25 });
};

export const addStudent = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Resolve teacher_id based on user type
    const u = req.user!;
    let teacherId: string;
    if (u.user_type === "center" || u.user_type === "staff") {
      teacherId = req.body.teacher_id;
      if (!teacherId || !u.center_teacher_ids?.includes(teacherId)) {
        res.status(403).json({ message: "ليس لديك صلاحية لإضافة طالب لهذا المدرس" });
        return;
      }
    } else if (u.is_admin) {
      teacherId = req.body.teacher_id || u.id;
      if (!u.is_super_admin && !u.allowed_teacher_ids?.includes(teacherId)) {
        res.status(403).json({ message: "ليس لديك صلاحية لإضافة طالب لهذا المدرس" });
        return;
      }
    } else {
      teacherId = u.id;
    }
    if (!await groupMatchesGrade(teacherId, req.body.group_id, req.body.grade_id)) { res.status(400).json({ message: "يجب أن تكون المجموعة في نفس الصف الدراسي للطالب" }); return; }
    if (!await validateOwnedReferences(teacherId, req.body)) { res.status(403).json({ message: "المجموعة أو المرحلة لا تنتمي للمدرس" }); return; }
    if (!validStudentDiscounts(req.body)) { res.status(400).json({ message: "نسبة الخصم يجب أن تكون رقمًا بين 0 و100" }); return; }
    const studentData = { ...req.body, teacher_id: teacherId };
    // Set group_join_date when student is added with a group
    if (studentData.group_id && !studentData.group_join_date) {
      studentData.group_join_date = getTodayInTimezone();
    }

    // ── Family auto-assign ──────────────────────────────────────────────────
    if (studentData.join_family_id) {
      studentData.sibling_family_id = studentData.join_family_id;
      if (!studentData.sibling_family_name) {
        const existingMember = await Student.findOne({
          teacher_id: teacherId,
          sibling_family_id: studentData.join_family_id,
        });
        if (existingMember?.sibling_family_name) {
          studentData.sibling_family_name = existingMember.sibling_family_name;
        }
      }
    } else if (studentData.create_new_family && studentData.parent_phone) {
      studentData.sibling_family_id = `FAM_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      if (!studentData.sibling_family_name) {
        const parts = (studentData.name as string)?.trim().split(/\s+/) || [];
        studentData.sibling_family_name = `عائلة ${parts[1] || parts[0] || ""}`;
      }
      await Student.updateMany(
        { teacher_id: teacherId, parent_phone: studentData.parent_phone, sibling_family_id: null },
        { sibling_family_id: studentData.sibling_family_id, sibling_family_name: studentData.sibling_family_name }
      );
    } else if (studentData.parent_phone) {
      const existing = await Student.findOne({
        teacher_id: teacherId,
        parent_phone: studentData.parent_phone,
        sibling_family_id: { $ne: null },
      });
      if (existing) studentData.sibling_family_id = existing.sibling_family_id;
    }
    delete studentData.join_family_id;
    delete studentData.create_new_family;

    // ── Center Student Identity ──────────────────────────────────────────────
    // لو المدرس في سنتر، نحدد هوية الطالب الموحدة داخل السنتر.
    // لو المستخدم مرر center_student_code موجود (من suggestion قديم) → نبحث عنه في CenterStudent
    // لو مرر center_student_code = "new" أو مش موجود → resolveOrCreateCenterStudent
    const passedCenterCode = studentData.center_student_code as string | undefined;
    delete studentData.center_student_code;
    delete studentData.center_student_id;

    const teacher = await Teacher.findById(teacherId).select("center_id").lean() as any;
    if (teacher?.center_id) {
      const centerId = String(teacher.center_id);
      const name        = String(studentData.name || "");
      const parentPhone = String(studentData.parent_phone || "");

      if (!parentPhone) {
        const resolved = await resolveOrCreateCenterStudent(centerId, name, "");
        studentData.center_student_code = resolved.centerStudentCode;
        studentData.center_student_id = resolved.centerStudentId;
      } else if (passedCenterCode && passedCenterCode !== "new") {
        // المستخدم اختار طالب موجود من الـ suggestion — ابحث عن الـ CenterStudent بالكود
        const { CenterStudent } = await import("../models/CenterStudent");
        const cs = await CenterStudent.findOne({ center_student_code: passedCenterCode, center_id: centerId }).lean();
        if (cs) {
          studentData.center_student_code = cs.center_student_code;
          studentData.center_student_id   = cs._id;
        } else {
          // الكود مش موجود في CenterStudent → أنشئ هوية جديدة
          const resolved = await resolveOrCreateCenterStudent(centerId, name, parentPhone);
          studentData.center_student_code = resolved.centerStudentCode;
          studentData.center_student_id   = resolved.centerStudentId;
        }
      } else {
        // الحالة الطبيعية: ابحث أو أنشئ CenterStudent
        const resolved = await resolveOrCreateCenterStudent(centerId, name, parentPhone);
        studentData.center_student_code = resolved.centerStudentCode;
        studentData.center_student_id   = resolved.centerStudentId;
      }
    }
    // لو المدرس مش في سنتر → center_student_code و center_student_id يفضلوا null

    // ── Auto-generate code ──────────────────────────────────────────────────
    if (studentData.group_id) {
      const group = await Group.findById(studentData.group_id);
      const groupCode = group?.code || null;
      if (groupCode) {
        studentData.code = await allocateStudentCode(teacherId, String(studentData.group_id), groupCode);
      } else {
        delete studentData.code;
      }
    } else {
      delete studentData.code;
    }

    // ── Inherit family discount before creating ─────────────────────────────
    if (studentData.sibling_family_id && !studentData.family_discount_percent) {
      const familyMember = await Student.findOne({
        teacher_id: teacherId,
        sibling_family_id: studentData.sibling_family_id,
      }).lean();
      if (familyMember) {
        studentData.family_discount_percent = (familyMember as any).family_discount_percent;
        studentData.family_discount_reason = (familyMember as any).family_discount_reason;
        studentData.family_book_discount_percent = (familyMember as any).family_book_discount_percent;
        studentData.family_book_discount_reason = (familyMember as any).family_book_discount_reason;
      }
    }

    const student = await (async () => {
      const created = await Student.create(studentData);
      const todayStr = getTodayInTimezone();
      const [todayYear, todayMonth] = todayStr.split("-").map(Number);
      const startMonth = Number(studentData.subscription_start_month) || todayMonth;
      const startYear = Number(studentData.subscription_start_year) || todayYear;
      // The generator already applies the student's family/individual discount.
      await generateSubscriptionsForStudent(String(created._id), studentData.teacher_id, startMonth, startYear);
      if (created.group_id) await StudentMembership.create({ student_id: created._id, teacher_id: teacherId, group_id: created.group_id, grade_id: created.grade_id, starts_on: created.group_join_date, ends_on: null, actor_id: req.user!.actor_id || req.user!.id, reason: "enrollment" });
      return created;
    })();

    const subscriptions = await MonthlySubscription.find({ student_id: student._id }).sort({ year: 1, month: 1 }).lean();
    res.status(201).json({ ...student.toObject(), id: String(student._id), _subscriptions: subscriptions.map(({ _id, __v, ...rest }: any) => ({ id: String(_id), ...rest })) });
  } catch (error: any) {
    if (error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء إضافة الطالب" });
  }
});

export const updateStudent = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Whitelist: فقط الحقول المسموح بتعديلها من الـ client
    const safeBody: Record<string, unknown> = {};
    for (const key of STUDENT_UPDATABLE_FIELDS) {
      if (key in req.body) safeBody[key] = req.body[key];
    }

    if (!validStudentDiscounts(safeBody)) { res.status(400).json({ message: "نسبة الخصم يجب أن تكون رقمًا بين 0 و100" }); return; }

    // Verify the student belongs to an allowed teacher
    const existing = await Student.findOne({ _id: req.params.id, ...teacherFilter(req) }).lean();
    if (!existing) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
    const teacherId = (existing as any).teacher_id.toString();
    if (!await validateOwnedReferences(teacherId, safeBody)) { res.status(403).json({ message: "المجموعة أو المرحلة لا تنتمي للمدرس" }); return; }

    const targetGroup = "group_id" in safeBody ? safeBody.group_id : existing.group_id;
    const targetGrade = "grade_id" in safeBody ? safeBody.grade_id : existing.grade_id;
    const transferring = !!targetGroup && String(targetGroup) !== String(existing.group_id || "");
    if ((transferring && String(targetGrade || "") !== String(existing.grade_id || "")) ||
        !await groupMatchesGrade(teacherId, targetGroup, targetGrade)) {
      res.status(400).json({ message: "يجب أن تكون المجموعة في نفس الصف الدراسي للطالب" }); return;
    }

    // ── Code generation on group change ────────────────────────────────────
    if ("group_id" in safeBody) {
      const newGroupId = safeBody.group_id || null;
      const oldGroupId = (existing as any).group_id?.toString() || null;

      if (newGroupId !== oldGroupId) {
        safeBody.group_join_date = newGroupId ? getTodayInTimezone() : null;
        if (newGroupId) {
          const group = await Group.findById(newGroupId);
          const groupCode = group?.code || null;
          if (groupCode) {
            safeBody.code = await allocateStudentCode(teacherId, String(newGroupId), groupCode);
          } else {
            safeBody.code = null;
          }
        } else {
          safeBody.code = null;
        }
      }
    }

    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, ...teacherFilter(req) },
      { $set: safeBody },
      { new: true }
    );
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

    if ("group_id" in safeBody && String(safeBody.group_id || "") !== String(existing.group_id || "")) {
      const today=getTodayInTimezone();
      const active=await StudentMembership.findOne({student_id:student._id,ends_on:null});
      if(active) await StudentMembership.updateOne({_id:active._id},{$set:{ends_on:today}});
      else if(existing.group_id) await StudentMembership.create({student_id:student._id,teacher_id:teacherId,group_id:existing.group_id,grade_id:existing.grade_id,starts_on:existing.group_join_date || new Date(existing.created_at).toLocaleDateString("en-CA",{timeZone:"Africa/Cairo"}),ends_on:today,reason:"imported current membership"});
      if(student.group_id)await StudentMembership.create({student_id:student._id,teacher_id:teacherId,group_id:student.group_id,grade_id:student.grade_id,starts_on:today,ends_on:null,actor_id:req.user!.actor_id || req.user!.id,reason:"group transfer"});
    }
    // ── Sync subscriptions if price-affecting fields changed ───────────────
    const priceChanged =
      "discount_value" in safeBody ||
      "custom_monthly_price" in safeBody ||
      ("group_id" in safeBody && safeBody.group_id !== (existing as any).group_id?.toString());

    if (priceChanged) {
      const basePrice = await resolveBasePrice(student.custom_monthly_price, student.group_id, teacherId);
      await syncDueSubscriptions(
        student._id,
        teacherId,
        basePrice,
        student.family_discount_percent,
        student.discount_value
      );
    }

    res.json(student);
  } catch (err: any) {
    if (err?.hasErrorLabel?.("TransientTransactionError")) throw err;
    console.error("[updateStudent] error:", err);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث الطالب" });
  }
});

export const deleteStudent = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const deletionIds = [req.params.id];
    const { BookSale } = await import("../models/BookSale");
    const history = await series([MonthlySubscription.exists({ student_id: { $in: deletionIds }, status: { $in: ["paid", "exempt"] } }), AttendanceRecord.exists({ student_id: { $in: deletionIds } }), ExamGrade.exists({ student_id: { $in: deletionIds } }), BookSale.exists({ student_id: { $in: deletionIds } })]);
    if (history.some(Boolean)) { res.status(409).json({ message: "يوجد سجل تاريخي مرتبط بالطالب؛ استخدم الإيقاف للحفاظ عليه" }); return; }
    const deleted = await Student.findOneAndDelete({ _id: req.params.id, ...teacherFilter(req) });
    if (!deleted) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
    await deleteStudentCascade(String(deleted._id), deleted.center_student_id ? String(deleted.center_student_id) : null);
    res.json({ message: "تم الحذف بنجاح" });
  } catch (error: any) {
    if (error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
  }
});

export const deleteStudents = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: "يجب تحديد طالب واحد على الأقل" });
      return;
    }
    // تحقق من ownership أولاً قبل الحذف
    const toDelete = await Student.find({ _id: { $in: ids }, ...teacherFilter(req) }).select("_id center_student_id").lean();
    if (toDelete.length === 0) { res.status(404).json({ message: "لم يتم العثور على الطلاب" }); return; }
    const confirmedIds = toDelete.map((s: any) => String(s._id));
    const centerStudentIds = toDelete.map((s: any) => s.center_student_id).filter(Boolean).map(String);

    const deletionIds = confirmedIds;
    const { BookSale } = await import("../models/BookSale");
    const history = await series([MonthlySubscription.exists({ student_id: { $in: deletionIds }, status: { $in: ["paid", "exempt"] } }), AttendanceRecord.exists({ student_id: { $in: deletionIds } }), ExamGrade.exists({ student_id: { $in: deletionIds } }), BookSale.exists({ student_id: { $in: deletionIds } })]);
    if (history.some(Boolean)) { res.status(409).json({ message: "يوجد سجل تاريخي مرتبط بالطالب؛ استخدم الإيقاف للحفاظ عليه" }); return; }
    await Student.deleteMany({ _id: { $in: confirmedIds } });
    for (const student of toDelete) await deleteStudentCascade(String(student._id), student.center_student_id ? String(student.center_student_id) : null);
    res.json({ message: "تم الحذف بنجاح" });
  } catch (error: any) {
    if (error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
  }
});

/** Card lookup is independent of pagination and always returns current membership. */
export const getStudentByQR = async (req: AuthRequest, res: Response): Promise<void> => {
  const raw = req.query.qr;
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) { res.status(400).json({ message: "رمز الطالب غير صالح" }); return; }
  const student = await findScannedStudent(teacherFilter(req), { student_code: raw });
  if (!student) { res.status(404).json({ message: "رمز الطالب غير موجود أو غير محدد بشكل واضح" }); return; }
  res.json({ ...student, id: String(student._id) });
};
