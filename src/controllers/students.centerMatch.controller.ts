import { Response } from "express";
import { Teacher } from "../models/Teacher";
import { AuthRequest } from "../middleware/auth";
import { findCenterStudentSuggestions } from "./students.helpers";

/**
 * GET /api/students/center-match?parent_phone=&grade_id=
 * يعيد قائمة بالطلاب المحتملين داخل نفس السنتر بنفس parent_phone + grade_id.
 * القرار النهائي للمستخدم — لا matching تلقائي.
 * متاح فقط لو المدرس داخل سنتر.
 */
export const getCenterStudentSuggestions = async (req: AuthRequest, res: Response): Promise<void> => {
  const u = req.user!;

  // تحديد teacher_id الفعلي
  let teacherId: string;
  if (u.user_type === "center" || u.user_type === "staff") {
    teacherId = req.query.teacher_id as string;
    if (!teacherId || !u.center_teacher_ids?.includes(teacherId)) {
      res.status(403).json({ message: "ليس لديك صلاحية" });
      return;
    }
  } else {
    teacherId = u.id;
  }

  // تحقق أن المدرس في سنتر
  const teacher = await Teacher.findById(teacherId).select("center_id").lean() as any;
  if (!teacher?.center_id) {
    res.json({ suggestions: [] });
    return;
  }

  const parentPhone = req.query.parent_phone as string;
  const gradeId = req.query.grade_id as string | undefined;

  if (!parentPhone) {
    res.json({ suggestions: [] });
    return;
  }

  const suggestions = await findCenterStudentSuggestions(
    String(teacher.center_id),
    parentPhone,
    gradeId
  );

  res.json({ suggestions });
};
