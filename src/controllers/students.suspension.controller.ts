import { Response } from "express";
import { Student } from "../models/Student";
import { AuthRequest, teacherFilter } from "../middleware/auth";

// All three functions now use teacherFilter(req) instead of teacher_id: req.user!.id
// so that admin and center users can suspend/unsuspend students in their permitted scope
// while cross-teacher attempts still return 404 (H7 fix).

export const suspendStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { suspended_until, suspension_reason } = req.body as {
      suspended_until?: string;
      suspension_reason?: string;
    };

    const until = suspended_until ? new Date(suspended_until) : null;
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, ...teacherFilter(req) },
      { is_suspended: true, suspended_until: until, suspension_reason: suspension_reason || null },
      { new: true }
    );
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
    res.json(student);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء إيقاف الطالب" });
  }
};

export const unsuspendStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, ...teacherFilter(req) },
      { is_suspended: false, suspended_until: null, suspension_reason: null },
      { new: true }
    );
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
    res.json(student);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء رفع الإيقاف" });
  }
};

export const checkStudentSuspension = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      ...teacherFilter(req),
    }).lean();
    if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

    const s = student as any;

    // Auto-lift إذا انتهت مدة الإيقاف
    if (s.is_suspended && s.suspended_until && new Date(s.suspended_until) < new Date()) {
      await Student.findOneAndUpdate(
        { _id: req.params.id, ...teacherFilter(req) },
        { is_suspended: false, suspended_until: null, suspension_reason: null }
      );
      res.json({ is_suspended: false, suspended_until: null, suspension_reason: null });
      return;
    }

    res.json({
      is_suspended: s.is_suspended || false,
      suspended_until: s.suspended_until || null,
      suspension_reason: s.suspension_reason || null,
    });
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء التحقق من حالة الإيقاف" });
  }
};
