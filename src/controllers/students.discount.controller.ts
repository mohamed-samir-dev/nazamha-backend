import { atomicController, series } from "../services/atomicController";
import { Response } from "express";
import { Student } from "../models/Student";
import { MonthlySubscription } from "../models/MonthlySubscription";
import { Group } from "../models/Group";
import { Teacher } from "../models/Teacher";
import { AuthRequest } from "../middleware/auth";
import { calcDiscount } from "./students.helpers";

export const setFamilyDiscount = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const { familyId, percent, reason, bookPercent, bookReason } = req.body as {
      familyId: string;
      percent: number | null;
      reason?: string;
      bookPercent?: number | null;
      bookReason?: string;
    };

    if (!familyId) { res.status(400).json({ message: "familyId مطلوب" }); return; }
    if (percent !== null && percent !== undefined && (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100)) {
      res.status(400).json({ message: "النسبة يجب أن تكون بين 0 و 100" }); return;
    }
    if (bookPercent !== null && bookPercent !== undefined && (typeof bookPercent !== "number" || !Number.isFinite(bookPercent) || bookPercent < 0 || bookPercent > 100)) {
      res.status(400).json({ message: "نسبة خصم الكتب يجب أن تكون بين 0 و 100" }); return;
    }

    await Student.updateMany(
      { teacher_id: teacherId, sibling_family_id: familyId },
      {
        family_discount_percent: percent ?? null,
        family_discount_reason: reason?.trim() || null,
        family_book_discount_percent: bookPercent ?? null,
        family_book_discount_reason: bookReason?.trim() || null,
      }
    );

    // جلب الطلاب + groups + teacher في parallel بدل N queries متسلسلة
    const familyStudents = await Student.find({ teacher_id: teacherId, sibling_family_id: familyId })
      .select("_id custom_monthly_price group_id discount_value")
      .lean();

    if (familyStudents.length > 0) {
      const groupIds = [...new Set(familyStudents.map((s: any) => s.group_id).filter(Boolean).map(String))];
      const [groups, teacher] = await series([
        groupIds.length ? Group.find({ _id: { $in: groupIds } }).lean().select("_id monthly_price") : Promise.resolve([]),
        Teacher.findById(teacherId).lean().select("monthly_price"),
      ]);
      const groupMap = new Map((groups as any[]).map((g: any) => [String(g._id), g.monthly_price || 0]));
      const teacherBasePrice = (teacher as any)?.monthly_price || 0;

      const ops = familyStudents.map((s: any) => {
        let basePrice = 0;
        if (s.custom_monthly_price != null && s.custom_monthly_price > 0) basePrice = s.custom_monthly_price;
        else if (s.group_id) basePrice = groupMap.get(String(s.group_id)) || teacherBasePrice;
        else basePrice = teacherBasePrice;

        const { amount, discount } = calcDiscount(basePrice, percent ?? null, s.discount_value);
        return {
          updateMany: {
            filter: { student_id: s._id, teacher_id: teacherId, status: { $in: ["due", "not_due"] } },
            update: { $set: { amount, discount } },
          },
        };
      });

      await MonthlySubscription.bulkWrite(ops as any[], { ordered: true });
    }

    res.json({ message: "تم تحديث خصم العائلة" });
  } catch (error: any) {
    if (error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء تحديث خصم العائلة" });
  }
});
