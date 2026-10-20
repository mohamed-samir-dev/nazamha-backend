import { atomicController, series } from "../services/atomicController";
import { Response } from "express";
import { Student } from "../models/Student";
import { SiblingFamily } from "../models/SiblingFamily";
import { AuthRequest } from "../middleware/auth";
import { resolveBasePrice, syncDueSubscriptions } from "./students.helpers";
import mongoose from "mongoose";

export const createFamily = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { familyName, parentPhone } = req.body as { familyName?: string; parentPhone?: string };
    if (!familyName?.trim()) { res.status(400).json({ message: "اسم العائلة مطلوب" }); return; }

    const doc = await SiblingFamily.create({
      teacher_id: teacherId,
      family_name: familyName.trim(),
      parent_phone: parentPhone?.trim() || null,
    });

    res.json({ familyId: String(doc._id), familyName: doc.family_name, parentPhone: doc.parent_phone });
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء العائلة" });
  }
};

export const lookupFamily = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, studentName } = req.query as { phone?: string; studentName?: string };
    const cleanPhone = phone ? decodeURIComponent(phone).trim() : "";
    const cleanName = studentName ? decodeURIComponent(studentName).trim() : "";
    const fatherName = cleanName.split(/\s+/)[1]?.toLowerCase() || null;

    if (!/^01\d{9}$/.test(cleanPhone)) { res.json({ family: null }); return; }

    const matched = await Student.find({ teacher_id: req.user!.id, parent_phone: cleanPhone }).lean() as any[];

    if (matched.length === 0) { res.json({ family: null }); return; }

    const existingFamilyId = matched.find((s: any) => s.sibling_family_id)?.sibling_family_id || null;
    const matchReason = "phone";

    res.json({ family: { familyId: existingFamilyId, members: matched, matchReason } });
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء البحث عن العائلة" });
  }
};

export const getPotentialSiblings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    // projection: فقط الحقول المطلوبة للكشف عن الإخوة المحتملين
    const allStudents = await Student.find({ teacher_id: teacherId })
      .select("name parent_phone sibling_family_id")
      .lean();

    const phoneMap: Record<string, typeof allStudents> = {};
    allStudents.forEach((s) => {
      if (!s.parent_phone) return;
      if (!phoneMap[s.parent_phone]) phoneMap[s.parent_phone] = [];
      phoneMap[s.parent_phone].push(s);
    });

    const potentials: { key: string; reason: string; members: typeof allStudents }[] = [];
    Object.entries(phoneMap).forEach(([phone, members]) => {
      if (members.length < 2) return;
      const familyIds = new Set(members.map((m) => m.sibling_family_id || null));
      if (familyIds.size === 1 && !familyIds.has(null)) return;
      potentials.push({ key: phone, reason: "phone", members });
    });

    res.json(potentials);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء جلب الإخوة المحتملين" });
  }
};

export const getSiblings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;

    // جلب العائلات المنشأة + الطلاب المرتبطين — projection محدود
    const [familyDocs, students] = await Promise.all([
      SiblingFamily.find({ teacher_id: teacherId }).lean(),
      Student.find({ teacher_id: teacherId, sibling_family_id: { $ne: null, $exists: true } })
        .select("name code group_id grade_id sibling_family_id sibling_family_name family_discount_percent family_discount_reason family_book_discount_percent family_book_discount_reason discount_value custom_monthly_price parent_phone")
        .sort({ name: 1 })
        .lean(),
    ]);

    // بناء map من الطلاب
    const studentMap: Record<string, typeof students> = {};
    students.forEach((s) => {
      (s as any).id = String((s as any)._id);
      const fid = s.sibling_family_id!;
      if (!studentMap[fid]) studentMap[fid] = [];
      studentMap[fid].push(s);
    });

    // دمج العائلات المنشأة مع الطلاب
    const familyIdSet = new Set(familyDocs.map((f) => String(f._id)));
    const families: { familyId: string; familyName: string; parentPhone?: string | null; members: typeof students }[] = [];

    // أولاً: العائلات المنشأة من الـ collection
    for (const doc of familyDocs) {
      const fid = String(doc._id);
      families.push({ familyId: fid, familyName: doc.family_name, parentPhone: doc.parent_phone, members: studentMap[fid] ?? [] });
    }

    // ثانياً: العائلات القديمة (FAM_xxx) اللي مش في الـ collection
    for (const [fid, members] of Object.entries(studentMap)) {
      if (!familyIdSet.has(fid) && members.length >= 1) {
        const anyName = members.find((m) => m.sibling_family_name)?.sibling_family_name;
        families.push({ familyId: fid, familyName: anyName || `عائلة`, members });
      }
    }

    res.json(families);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء جلب العائلات" });
  }
};

export const linkSiblings = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { studentIds, familyName } = req.body as { studentIds: string[]; familyName?: string };

    if (!Array.isArray(studentIds) || studentIds.length < 2) {
      res.status(400).json({ message: "يجب تحديد طالبين على الأقل" });
      return;
    }

    const students = await Student.find({ _id: { $in: studentIds }, teacher_id: teacherId });
    if (students.length < 2 || students.length !== new Set(studentIds).size) { res.status(400).json({ message: "لم يتم العثور على الطلاب" }); return; }

    const selectedFamilies = new Set(students.map(s => s.sibling_family_id).filter(Boolean));
    if (selectedFamilies.size > 1) { res.status(400).json({ message: "الطلاب من عائلات مختلفة؛ استخدم نقل الطالب للعائلة المطلوبة" }); return; }

    // تحديد الـ familyId: من الطلاب الموجودين أو إنشاء جديد
    const existingFamilyId =
      students.find((s) => s.sibling_family_id)?.sibling_family_id ||
      `FAM_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // جلب اسم العائلة من الـ collection لو موجود
    const familyDoc = mongoose.isObjectIdOrHexString(existingFamilyId) ? await SiblingFamily.findOne({ _id: existingFamilyId, teacher_id: teacherId }).lean() : null;
    const autoName = familyName || familyDoc?.family_name || (() => {
      const parts = students[0]?.name?.trim().split(/\s+/) || [];
      return `عائلة ${parts[1] || parts[0] || ""}`;
    })();

    // جلب خصم العائلة الحالية لو موجود
    const discountSource = await Student.findOne({
      teacher_id: teacherId,
      sibling_family_id: existingFamilyId,    }).lean();
    const familyDiscountPct = discountSource ? (discountSource as any).family_discount_percent : null;
    const familyDiscountReason = discountSource ? (discountSource as any).family_discount_reason : null;
    const familyBookPct = discountSource ? (discountSource as any).family_book_discount_percent : null;
    const familyBookReason = discountSource ? (discountSource as any).family_book_discount_reason : null;

    const updateFields: Record<string, unknown> = {
      sibling_family_id: existingFamilyId,
      sibling_family_name: autoName,
      family_discount_percent: familyDiscountPct,
      family_discount_reason: familyDiscountReason,
      family_book_discount_percent: familyBookPct,
      family_book_discount_reason: familyBookReason,
    };

    await Student.updateMany(
      { _id: { $in: studentIds }, teacher_id: teacherId },
      updateFields
    );

    // تطبيق الخصم على اشتراكات الطلاب في العائلة
    for (const sid of studentIds) {
      const s = await Student.findOne({ _id: sid, teacher_id: teacherId }).lean();
      if (!s) continue;
      const basePrice = await resolveBasePrice((s as any).custom_monthly_price, (s as any).group_id, teacherId);
      await syncDueSubscriptions(sid, teacherId, basePrice, familyDiscountPct, (s as any).discount_value);
    }

    res.json({ message: "تم الربط بنجاح", familyId: existingFamilyId, familyName: autoName });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء ربط الإخوة" });
  }
});

export const renameFamiliy = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { familyId, familyName } = req.body as { familyId: string; familyName: string };
    if (!familyId || !familyName?.trim()) { res.status(400).json({ message: "البيانات ناقصة" }); return; }

    const [studentsResult, family] = await series([
      Student.updateMany(
        { teacher_id: teacherId, sibling_family_id: familyId },
        { sibling_family_name: familyName.trim() }
      ),
      mongoose.isObjectIdOrHexString(familyId)
        ? SiblingFamily.findOneAndUpdate({ _id: familyId, teacher_id: teacherId }, { family_name: familyName.trim() })
        : Promise.resolve(null),
    ]);
    if (!studentsResult.matchedCount && !family) {
      res.status(404).json({ message: "العائلة غير موجودة" });
      return;
    }
    res.json({ message: "تم تحديث اسم العائلة" });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء تحديث اسم العائلة" });
  }
});

export const transferFamily = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { studentId, targetFamilyId } = req.body as { studentId: string; targetFamilyId: string };
    if (!studentId || !targetFamilyId) { res.status(400).json({ message: "البيانات ناقصة" }); return; }

    // جلب الطالب
    const student = await Student.findOne({ _id: studentId, teacher_id: teacherId }).lean();
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

    // جلب بيانات العائلة الجديدة (الاسم + الخصم)
    const targetMember = await Student.findOne({
      teacher_id: teacherId,
      sibling_family_id: targetFamilyId,
    }).lean();

    const targetFamily = targetMember || !mongoose.isObjectIdOrHexString(targetFamilyId) ? null : await SiblingFamily.findOne({ _id: targetFamilyId, teacher_id: teacherId }).lean();
    if (!targetMember && !targetFamily) { res.status(404).json({ message: "العائلة المطلوبة غير موجودة" }); return; }
    const targetFamilyName = (targetMember as any)?.sibling_family_name || targetFamily?.family_name || null;
    const newFamilyPct = (targetMember as any)?.family_discount_percent ?? null;
    const newFamilyReason = (targetMember as any)?.family_discount_reason ?? null;
    const newBookPct = (targetMember as any)?.family_book_discount_percent ?? null;
    const newBookReason = (targetMember as any)?.family_book_discount_reason ?? null;

    const oldFamilyId = (student as any).sibling_family_id as string | null;

    // تحديث الطالب: فصله عن القديمة وربطه بالجديدة مع وراثة الخصم
    await Student.updateOne(
      { _id: studentId, teacher_id: teacherId },
      {
        sibling_family_id: targetFamilyId,
        sibling_family_name: targetFamilyName,
        family_discount_percent: newFamilyPct,
        family_discount_reason: newFamilyReason,
        family_book_discount_percent: newBookPct,
        family_book_discount_reason: newBookReason,
      }
    );

    // لو العائلة القديمة فضل فيها طالب واحد بس، امسح منه بيانات العائلة والخصم
    if (oldFamilyId && oldFamilyId !== targetFamilyId) {
      const remainingCount = await Student.countDocuments({
        teacher_id: teacherId,
        sibling_family_id: oldFamilyId,
      });
      if (remainingCount === 1) {
        const loneStudent = await Student.findOne({ teacher_id: teacherId, sibling_family_id: oldFamilyId }).lean();
        await Student.updateOne(
          { teacher_id: teacherId, sibling_family_id: oldFamilyId },
          {
            sibling_family_id: null,
            sibling_family_name: null,
            family_discount_percent: null,
            family_discount_reason: null,
            family_book_discount_percent: null,
            family_book_discount_reason: null,
          }
        );
        // sync اشتراكات الطالب المتبقي بدون خصم عائلي
        if (loneStudent) {
          const loneBase = await resolveBasePrice((loneStudent as any).custom_monthly_price, (loneStudent as any).group_id, teacherId);
          await syncDueSubscriptions((loneStudent as any)._id, teacherId, loneBase, null, (loneStudent as any).discount_value);
        }
      }
    }

    // sync اشتراكات الطالب المنقول بالخصم الجديد
    const basePrice = await resolveBasePrice((student as any).custom_monthly_price, (student as any).group_id, teacherId);
    await syncDueSubscriptions(studentId, teacherId, basePrice, newFamilyPct, (student as any).discount_value);

    res.json({ message: "تم النقل بنجاح", familyId: targetFamilyId, familyName: targetFamilyName });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء نقل الطالب" });
  }
});

export const deleteFamily = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { familyId } = req.params;
    if (!familyId) { res.status(400).json({ message: "familyId مطلوب" }); return; }

    const members = await Student.find({ teacher_id: teacherId, sibling_family_id: familyId }).lean();

    await Student.updateMany(
      { teacher_id: teacherId, sibling_family_id: familyId },
      {
        sibling_family_id: null,
        sibling_family_name: null,
        family_discount_percent: null,
        family_discount_reason: null,
        family_book_discount_percent: null,
        family_book_discount_reason: null,
      }
    );

    if (mongoose.isObjectIdOrHexString(familyId)) await SiblingFamily.findOneAndDelete({ _id: familyId, teacher_id: teacherId });

    // sync اشتراكات كل الأعضاء بدون خصم عائلي
    for (const member of members) {
      const basePrice = await resolveBasePrice((member as any).custom_monthly_price, (member as any).group_id, teacherId);
      await syncDueSubscriptions((member as any)._id, teacherId, basePrice, null, (member as any).discount_value);
    }

    res.json({ message: "تم حذف العائلة" });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء حذف العائلة" });
  }
});

export const unlinkSibling = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { studentId } = req.body as { studentId: string };

    if (!studentId?.trim()) {
      res.status(400).json({ message: "studentId مطلوب" });
      return;
    }

    const student = await Student.findOne({ _id: studentId, teacher_id: teacherId }).lean();
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

    const familyId = (student as any).sibling_family_id;

    await Student.updateOne(
      { _id: studentId, teacher_id: teacherId },
      {
        sibling_family_id: null,
        sibling_family_name: null,
        family_discount_percent: null,
        family_discount_reason: null,
        family_book_discount_percent: null,
        family_book_discount_reason: null,
      }
    );

    const basePrice = await resolveBasePrice((student as any).custom_monthly_price, (student as any).group_id, teacherId);
    await syncDueSubscriptions(studentId, teacherId, basePrice, null, (student as any).discount_value);

    // لو فضل طالب واحد بس في العائلة، امسح منه الخصم كمان
    if (familyId) {
      const remaining = await Student.find({ teacher_id: teacherId, sibling_family_id: familyId }).lean();
      if (remaining.length === 1) {
        const lone = remaining[0];
        await Student.updateOne(
          { _id: (lone as any)._id, teacher_id: teacherId },
          {
            family_discount_percent: null,
            family_discount_reason: null,
            family_book_discount_percent: null,
            family_book_discount_reason: null,
          }
        );
        const loneBase = await resolveBasePrice((lone as any).custom_monthly_price, (lone as any).group_id, teacherId);
        await syncDueSubscriptions((lone as any)._id, teacherId, loneBase, null, (lone as any).discount_value);
      }
    }

    res.json({ message: "تم فصل الطالب عن العائلة" });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء فصل الطالب" });
  }
});
