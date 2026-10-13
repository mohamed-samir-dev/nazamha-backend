import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { Book } from "../models/Book";
import { QuestionBank } from "../models/QuestionBank";
import { Response } from "express";
import { Grade } from "../models/Grade";
import { AuthRequest, teacherFilter } from "../middleware/auth";

function resolveTeacherId(req: AuthRequest): string {
  if (req.user!.user_type === "staff" && req.user!.effective_teacher_id) {
    return req.user!.effective_teacher_id;
  }
  return req.user!.id;
}

export const getGrades = async (req: AuthRequest, res: Response): Promise<void> => {
  const grades = await Grade.find(teacherFilter(req)).sort({ created_at: 1 });
  res.json(grades);
};

export const addGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  const grade = await Grade.create({ ...req.body, teacher_id: resolveTeacherId(req) });
  res.status(201).json(grade);
};

export const updateGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  // Whitelist the fields that are user-editable — prevents mass assignment (H6 fix).
  // Fields like teacher_id, _id, created_at are silently dropped.
  const ALLOWED_FIELDS = ["name", "description"] as const;
  const updatePayload: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      updatePayload[field] = req.body[field];
    }
  }

  const grade = await Grade.findOneAndUpdate(
    { _id: req.params.id, ...teacherFilter(req) },
    updatePayload,
    { new: true, runValidators: true }
  );
  if (!grade) { res.status(404).json({ message: "المرحلة غير موجودة" }); return; }
  res.json(grade);
};

export const deleteGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  const used = await Promise.all([Student, Group, Book, QuestionBank].map((model: any) => model.exists({ grade_id: req.params.id, ...teacherFilter(req) })));
  if (used.some(Boolean)) { res.status(409).json({ message: "الصف مستخدم؛ انقل السجلات المرتبطة قبل حذفه" }); return; }
  await Grade.findOneAndDelete({ _id: req.params.id, ...teacherFilter(req) });
  res.json({ message: "تم الحذف بنجاح" });
};
