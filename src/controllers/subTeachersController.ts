import { Response } from "express";
import { SubTeacher } from "../models/SubTeacher";
import { AuthRequest } from "../middleware/auth";
import mongoose from "mongoose";

function resolveOwnerTeacherId(req: AuthRequest): string | null {
  const u = req.user!;
  if (u.user_type === "teacher") return u.id;
  if (u.user_type === "staff" && u.effective_teacher_id) return u.effective_teacher_id;
  if (u.is_admin) {
    const tid = (req.query.teacher_id as string) || (req.body.teacher_id as string) || u.id;
    if (u.is_super_admin || u.allowed_teacher_ids?.includes(tid)) return tid;
    return null;
  }
  return null;
}

export const getSubTeachers = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = resolveOwnerTeacherId(req);
  if (!teacherId) {
    res.status(403).json({ message: "غير مصرح لك بعرض المدرسين المساعدين" });
    return;
  }
  const subTeachers = await SubTeacher.find({ center_id: teacherId }).sort({ created_at: -1 });
  res.json(subTeachers);
};

export const addSubTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = resolveOwnerTeacherId(req);
  if (!teacherId) {
    res.status(403).json({ message: "غير مصرح لك بإضافة مدرس مساعد" });
    return;
  }

  const { name, phone, subject, grade_ids } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ message: "اسم المعلم مطلوب" });
    return;
  }

  const validGradeIds = Array.isArray(grade_ids)
    ? grade_ids.filter((id) => mongoose.Types.ObjectId.isValid(id))
    : [];

  const subTeacher = await SubTeacher.create({
    name: String(name).trim(),
    phone: phone ? String(phone).trim() : undefined,
    subject: subject ? String(subject).trim() : undefined,
    grade_ids: validGradeIds,
    center_id: new mongoose.Types.ObjectId(teacherId),
  });

  res.status(201).json(subTeacher);
};

export const deleteSubTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const teacherId = resolveOwnerTeacherId(req);
  if (!teacherId) {
    res.status(403).json({ message: "غير مصرح لك بحذف مدرس مساعد" });
    return;
  }

  const deleted = await SubTeacher.findOneAndDelete({ _id: req.params.id, center_id: teacherId });
  if (!deleted) {
    res.status(404).json({ message: "المعلم غير موجود أو لا ينتمي لحسابك" });
    return;
  }

  res.json({ message: "تم الحذف بنجاح" });
};
