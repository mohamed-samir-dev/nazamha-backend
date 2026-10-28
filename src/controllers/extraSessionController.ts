import { Response } from "express";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { Group } from "../models/Group";
import { AttendanceSession } from "../models/AttendanceSession";
import { AttendanceRecord } from "../models/AttendanceRecord";
import { scheduledOn } from "../utils/attendanceSession";
import { getTodayInTimezone } from "../utils/timezoneUtils";

export const createExtraSession = async (req: AuthRequest, res: Response): Promise<void> => {
  const { group_id, session_date, time, title } = req.body;
  if (!group_id || !session_date) {
    res.status(400).json({ message: "يرجى تحديد المجموعة وتاريخ الحصة" });
    return;
  }

  if (typeof session_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(session_date) || !Number.isFinite(Date.parse(session_date))) {
    res.status(400).json({ message: "تاريخ الحصة غير صالح" });
    return;
  }

  const today = getTodayInTimezone();
  if (session_date < today) {
    res.status(400).json({ message: "لا يمكن إضافة حصة إضافية في تاريخ ماضٍ" });
    return;
  }

  const filter = teacherFilter(req);
  const group = await Group.findOne({ _id: group_id, ...filter }).lean() as any;
  if (!group) {
    res.status(404).json({ message: "المجموعة غير موجودة" });
    return;
  }

  if (scheduledOn(group, session_date)) {
    res.status(400).json({ message: "هذا اليوم من المواعيد الأسبوعية الأساسية للمجموعة بالفعل" });
    return;
  }

  const existing = await AttendanceSession.findOne({ group_id: group._id, session_date });
  if (existing && !existing.cancelled) {
    res.status(400).json({ message: "توجد حصة إضافية مسجلة بالفعل في هذا التاريخ للمجموعة" });
    return;
  }

  const teacherId = String(group.teacher_id);
  const sessionTime = time || group.time || "17:00";

  let savedSession;
  if (existing) {
    existing.cancelled = false;
    existing.time = sessionTime;
    existing.is_extra = true;
    if (title) existing.title = title;
    await existing.save();
    savedSession = existing;
  } else {
    savedSession = await AttendanceSession.create({
      teacher_id: teacherId,
      group_id: group._id,
      session_date,
      time: sessionTime,
      cancelled: false,
      is_extra: true,
      title: title || "حصة إضافية",
    });
  }

  res.status(201).json({
    message: "تمت إضافة الحصة الإضافية بنجاح",
    session: {
      id: String(savedSession._id),
      group_id: String(group._id),
      session_date,
      time: sessionTime,
      cancelled: false,
      is_extra: true,
      title: savedSession.title || "حصة إضافية",
    },
  });
};

export const deleteExtraSession = async (req: AuthRequest, res: Response): Promise<void> => {
  const { group_id, session_date } = req.body;
  if (!group_id || !session_date) {
    res.status(400).json({ message: "يرجى تحديد المجموعة وتاريخ الحصة" });
    return;
  }

  const filter = teacherFilter(req);
  const group = await Group.findOne({ _id: group_id, ...filter }).lean();
  if (!group) {
    res.status(404).json({ message: "المجموعة غير موجودة" });
    return;
  }

  const recordsCount = await AttendanceRecord.countDocuments({ group_id, session_date });
  if (recordsCount > 0) {
    res.status(400).json({ message: "لا يمكن حذف حصة إضافية مسجل بها حضور بالفعل. يمكنك إلغاؤها بدلاً من ذلك" });
    return;
  }

  const result = await AttendanceSession.findOneAndDelete({ group_id, session_date, ...filter });
  if (!result) {
    res.status(404).json({ message: "الحصة الإضافية غير موجودة" });
    return;
  }

  res.json({ message: "تم حذف الحصة الإضافية بنجاح" });
};
