import { atomicController, series } from "../services/atomicController";
import { StudentMembership } from "../models/StudentMembership";
import { validateOwnedReferences } from "../utils/ownedReferences";
import crypto from "crypto";
import { Request, Response } from "express";
import { Group } from "../models/Group";
import { Student } from "../models/Student";
import { AuthRequest, teacherFilter } from "../middleware/auth";

function signCalendarFeedSig(teacherId: string): string {
  const secret = process.env.JWT_SECRET || "nazamha-calendar-secret";
  return crypto.createHmac("sha256", secret).update(`calendar-feed:${teacherId}`).digest("hex").slice(0, 32);
}

async function buildTeacherIcsContent(filter: Record<string, unknown>): Promise<string> {
  const groups = await Group.find(filter).lean();
  const { Grade } = await import("../models/Grade");
  const grades = await Grade.find(filter).lean();

  const dayMap: Record<string, string> = {
    "\u0627\u0644\u0633\u0628\u062a": "SA", "\u0627\u0644\u0623\u062d\u062f": "SU", "\u0627\u0644\u0625\u062b\u0646\u064a\u0646": "MO",
    "\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621": "TU", "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621": "WE", "\u0627\u0644\u062e\u0645\u064a\u0633": "TH", "\u0627\u0644\u062c\u0645\u0639\u0629": "FR",
  };
  const iCalDayToJS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextDate = (icalDay: string): Date => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = iCalDayToJS[icalDay];
    const diff = (target - today.getDay() + 7) % 7;
    const d = new Date(today); d.setDate(today.getDate() + (diff === 0 ? 0 : diff));
    return d;
  };
  const toICalDate = (date: Date, time: string) => {
    const [h, m] = time.split(":").map(Number);
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(h)}${pad(m)}00`;
  };
  const fold = (line: string) => {
    const bytes = Buffer.from(line, "utf8");
    if (bytes.length <= 75) return line;
    const result: string[] = [];
    let offset = 0;
    let first = true;
    while (offset < bytes.length) {
      const chunk = first ? 75 : 74;
      result.push((first ? "" : " ") + bytes.slice(offset, offset + chunk).toString("utf8"));
      offset += chunk; first = false;
    }
    return result.join("\r\n");
  };

  const dtStamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nazamha//StudentTracker//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:مواعيد المجموعات الدراسية - نظمها",
    "X-WR-TIMEZONE:Africa/Cairo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  groups.forEach((g: any) => {
    const rawDays = g.day_of_week.split(/\s*[\u060c,]\s*/).map((d: string) => d.trim()).filter(Boolean);
    rawDays.forEach((arabicDay: string) => {
      const icalDay = dayMap[arabicDay];
      if (!icalDay || !g.time) return;
      const startDate = nextDate(icalDay);
      const [h, m] = g.time.split(":").map(Number);
      const endDate = new Date(startDate); endDate.setHours(h + 1, m, 0, 0);
      const dtStart = toICalDate(startDate, g.time);
      const dtEnd = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
      const grade = grades.find((gr: any) => String(gr._id) === String(g.grade_id));
      const summary = `${g.name}${grade ? ` - ${(grade as any).name}` : ""}`;
      const descParts = [
        g.code ? `كود المجموعة: ${g.code}` : "",
        grade ? `السنة الدراسية: ${(grade as any).name}` : "",
        g.monthly_price != null ? `الاشتراك الشهري: ${g.monthly_price} ج.م` : "",
      ].filter(Boolean).join("\\n");
      const eventUid = `group-${String(g._id)}-${icalDay}@nazamha.app`;
      lines.push(
        "BEGIN:VEVENT",
        fold(`UID:${eventUid}`),
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${icalDay}`,
        fold(`SUMMARY:${summary}`),
        ...(descParts ? [fold(`DESCRIPTION:${descParts}`)] : []),
        "BEGIN:VALARM",
        "TRIGGER:-PT30M",
        "ACTION:DISPLAY",
        fold(`DESCRIPTION:تذكير بموعد ${summary}`),
        "END:VALARM",
        "END:VEVENT"
      );
    });
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export const getCalendarSyncUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.effective_teacher_id || req.user!.id;
    const sig = signCalendarFeedSig(teacherId);
    res.json({ teacherId, sig });
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء تجهيز رابط التقويم" });
  }
};

export const exportPublicCalendarFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = String(req.params.teacherId || "");
    const sig = String(req.query.sig || "");
    if (!teacherId || !sig || sig !== signCalendarFeedSig(teacherId)) {
      res.status(401).json({ message: "رابط التقويم غير صالح" });
      return;
    }
    const icsContent = await buildTeacherIcsContent({ teacher_id: teacherId });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "inline; filename=\"nazamha-schedule.ics\"");
    res.send(icsContent);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء تصدير التقويم" });
  }
};

export const exportCalendar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const icsContent = await buildTeacherIcsContent(teacherFilter(req));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "inline; filename=\"calendar.ics\"");
    res.send(icsContent);
  } catch {
    res.status(500).json({ message: "\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u062a\u0635\u062f\u064a\u0631 \u0627\u0644\u062a\u0642\u0648\u064a\u0645" });
  }
};

export const getGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const groups = await Group.find(teacherFilter(req)).sort({ created_at: -1 });
    res.json(groups);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء جلب المجموعات" });
  }
};

export const getGroupsBySubTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // teacherFilter scopes the query to the requesting user's teacher — prevents IDOR (H2 fix)
    const groups = await Group.find({
      sub_teacher_id: req.params.subTeacherId,
      ...teacherFilter(req),
    }).sort({ created_at: -1 });
    res.json(groups);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء جلب المجموعات" });
  }
};

export const addGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, day_of_week, time, monthly_price } = req.body;
    if (!name?.trim()) { res.status(400).json({ message: "اسم المجموعة مطلوب" }); return; }
    if (!day_of_week?.trim()) { res.status(400).json({ message: "يوم المجموعة مطلوب" }); return; }
    if (!time?.trim()) { res.status(400).json({ message: "وقت المجموعة مطلوب" }); return; }
    if (monthly_price == null || Number(monthly_price) <= 0) { res.status(400).json({ message: "سعر الاشتراك الشهري مطلوب" }); return; }
    // Resolve teacher_id: assistant always uses effective_teacher_id
    let teacherId: string;
    if (req.user!.user_type === "staff" && req.user!.effective_teacher_id) {
      teacherId = req.user!.effective_teacher_id;
    } else if (req.user!.is_admin) {
      teacherId = req.body.teacher_id || req.user!.id;
    } else if (req.user!.user_type === "center" || req.user!.user_type === "staff") {
      teacherId = req.body.teacher_id;
      if (!req.user!.center_teacher_ids?.includes(teacherId)) {
        res.status(403).json({ message: "ليس لديك صلاحية لإنشاء مجموعة لهذا المدرس" }); return;
      }
    } else {
      teacherId = req.user!.id;
    }

    if (req.user!.is_admin && !req.user!.is_super_admin && !req.user!.allowed_teacher_ids?.includes(teacherId)) {
      res.status(403).json({ message: "ليس لديك صلاحية لإنشاء مجموعة لهذا المدرس" }); return;
    }

    const {
      name: groupName,
      code,
      day_of_week: groupDayOfWeek,
      time: groupTime,
      is_private,
      grade_id,
      sub_teacher_id,
      sessions_per_month,
      monthly_price: groupMonthlyPrice,
      start_date,
    } = req.body;

    const groupData: Record<string, any> = {
      name: String(groupName).trim(),
      day_of_week: String(groupDayOfWeek).trim(),
      time: String(groupTime).trim(),
      monthly_price: Number(groupMonthlyPrice),
      teacher_id: teacherId,
    };

    if (code !== undefined) groupData.code = code ? String(code).trim() : undefined;
    if (is_private !== undefined) groupData.is_private = Boolean(is_private);
    if (grade_id !== undefined) groupData.grade_id = grade_id || null;
    if (sub_teacher_id !== undefined) groupData.sub_teacher_id = sub_teacher_id || null;
    if (sessions_per_month !== undefined) groupData.sessions_per_month = Number(sessions_per_month) || 4;
    if (start_date !== undefined) groupData.start_date = start_date || null;

    if (!await validateOwnedReferences(teacherId, groupData)) { res.status(403).json({ message: "مرجع غير مصرح" }); return; }
    const group = await Group.create(groupData);
    res.status(201).json(group);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء المجموعة" });
  }
};

export const addGroupsBulk = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const groups = req.body;
    if (!Array.isArray(groups) || groups.length === 0) {
      res.status(400).json({ message: "يجب إرسال مصفوفة من المجموعات" }); return;
    }
    const docs = groups.map((g) => ({
      name: String(g.name || "").trim(),
      code: g.code ? String(g.code).trim() : undefined,
      day_of_week: String(g.day_of_week || "").trim(),
      time: String(g.time || "").trim(),
      is_private: Boolean(g.is_private),
      grade_id: g.grade_id || null,
      sub_teacher_id: g.sub_teacher_id || null,
      sessions_per_month: g.sessions_per_month ? Number(g.sessions_per_month) : 4,
      monthly_price: g.monthly_price != null ? Number(g.monthly_price) : null,
      start_date: g.start_date || null,
      teacher_id: req.user!.id,
    }));
    if (!(await Promise.all(docs.map(doc => validateOwnedReferences(String(doc.teacher_id), doc)))).every(Boolean)) { res.status(403).json({ message: "مرجع غير مصرح" }); return; }
    const inserted = await Group.insertMany(docs, { ordered: true });
    res.status(201).json(inserted);
  } catch (err: any) {
    if (err?.name === "MongoBulkWriteError" && err?.insertedDocs?.length) {
      res.status(207).json({ inserted: err.insertedDocs, message: "تم إدراج بعض المجموعات فقط بسبب خطأ في الاتصال" });
    } else {
      res.status(503).json({ message: "تعذر الاتصال بقاعدة البيانات، يرجى المحاولة مرة أخرى" });
    }
  }
};

export const deleteGroupsBulk = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: "يجب إرسال مصفوفة من المعرفات" }); return;
    }
    const { MonthlySubscription } = await import("../models/MonthlySubscription");
    const { AttendanceRecord } = await import("../models/AttendanceRecord");

    const studentIds = await Student.find(
      { group_id: { $in: ids }, ...teacherFilter(req) }, { _id: 1 }
    ).lean().then((s) => s.map((s) => s._id));

    const hasHistory = await AttendanceRecord.exists({group_id:{$in:ids},...teacherFilter(req)}) || await StudentMembership.exists({group_id:{$in:ids},...teacherFilter(req)});
    if(hasHistory){res.status(409).json({message:"المجموعة مرتبطة بسجل تاريخي ولا يمكن حذفها"});return;}
    await series([
      Group.deleteMany({ _id: { $in: ids }, ...teacherFilter(req) }),
      Student.updateMany({ _id: { $in: studentIds } }, { $set: { group_id: null, group_join_date: null } }),
      studentIds.length
        ? MonthlySubscription.deleteMany({ student_id: { $in: studentIds }, status: { $in: ["due", "not_due"] } })
        : Promise.resolve(),
      AttendanceRecord.deleteMany({ group_id: { $in: ids }, ...teacherFilter(req) }),
    ]);
    res.json({ message: "تم الحذف بنجاح" });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    res.status(500).json({ message: "حدث خطأ أثناء حذف المجموعات" });
  }
});

export const updateGroup = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const priceChanged = req.body.monthly_price !== undefined && req.body.monthly_price !== null;

    // Whitelist allowed fields for update
    const allowedUpdate: Record<string, any> = {};
    if (req.body.name !== undefined) allowedUpdate.name = String(req.body.name).trim();
    if (req.body.code !== undefined) allowedUpdate.code = req.body.code ? String(req.body.code).trim() : null;
    if (req.body.day_of_week !== undefined) allowedUpdate.day_of_week = String(req.body.day_of_week).trim();
    if (req.body.time !== undefined) allowedUpdate.time = String(req.body.time).trim();
    if (req.body.is_private !== undefined) allowedUpdate.is_private = Boolean(req.body.is_private);
    if (req.body.grade_id !== undefined) allowedUpdate.grade_id = req.body.grade_id || null;
    if (req.body.sub_teacher_id !== undefined) allowedUpdate.sub_teacher_id = req.body.sub_teacher_id || null;
    if (req.body.sessions_per_month !== undefined) allowedUpdate.sessions_per_month = Number(req.body.sessions_per_month) || 4;
    if (req.body.monthly_price !== undefined) allowedUpdate.monthly_price = Number(req.body.monthly_price);
    if (req.body.start_date !== undefined) allowedUpdate.start_date = req.body.start_date || null;

    const owner = await Group.findOne({ _id: req.params.id, ...teacherFilter(req) }).lean();
    if (!owner) { res.status(404).json({ message: "المجموعة غير موجودة" }); return; }
    if (!await validateOwnedReferences(String(owner.teacher_id), allowedUpdate)) { res.status(403).json({ message: "مرجع غير مصرح" }); return; }
    if ("grade_id" in allowedUpdate && String(allowedUpdate.grade_id || "") !== String(owner.grade_id || "") && await Student.exists({group_id:owner._id,...teacherFilter(req)})) {res.status(409).json({message:"لا يمكن تغيير صف مجموعة تضم طلابًا"});return;}
    const oldGroup = await Group.findOneAndUpdate(
      { _id: req.params.id, ...teacherFilter(req) },
      { $set: allowedUpdate },
      { new: false, runValidators: true }
    );
    if (!oldGroup) { res.status(404).json({ message: "المجموعة غير موجودة" }); return; }
    const group = { ...oldGroup.toJSON(), ...allowedUpdate };
    const oldPrice = oldGroup.monthly_price;
    const oldCode = oldGroup.code;
    const newCode = allowedUpdate.code;

    // ── Update student codes when group code changes ──────────────────────
    if (newCode && oldCode && newCode !== oldCode) {
      const students = await Student.find(
        { group_id: req.params.id, ...teacherFilter(req) },
        { _id: 1, code: 1 }
      ).lean();
      const ops = students
        .filter((s) => s.code?.startsWith(`${oldCode}-`))
        .map((s) => ({
          updateOne: {
            filter: { _id: s._id },
            update: { code: (s.code as string).replace(`${oldCode}-`, `${newCode}-`) },
          },
        }));
      if (ops.length) await Student.bulkWrite(ops);
    }
    if (priceChanged && Number(req.body.monthly_price) !== Number(oldPrice)) {
      const { MonthlySubscription } = await import("../models/MonthlySubscription");
      const students = await Student.find(
        { ...teacherFilter(req), group_id: req.params.id, custom_monthly_price: { $in: [null, false, 0] } },
        { _id: 1, family_discount_percent: 1, discount_value: 1 }
      ).lean();
      const newPrice = Number(req.body.monthly_price);
      const ops = students.map((student) => {
        const pct = (student.family_discount_percent ?? 0) > 0
          ? student.family_discount_percent!
          : (Number(student.discount_value) || 0);
        const net = pct > 0 ? Math.round(newPrice * (1 - pct / 100)) : newPrice;
        return {
          updateMany: {
            filter: { student_id: student._id, ...teacherFilter(req), status: "due" },
            update: { amount: newPrice, discount: newPrice - net },
          },
        };
      });
      if (ops.length) await MonthlySubscription.bulkWrite(ops);
    }
    res.json(group);
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    if (!res.headersSent) res.status(500).json({ message: "حدث خطأ أثناء تعديل المجموعة" });
  }
});

export const toggleCancelSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date } = req.body;
    if (!date) { res.status(400).json({ message: "التاريخ مطلوب" }); return; }
    const group = await Group.findOne({ _id: req.params.id, ...teacherFilter(req) });
    if (!group) { res.status(404).json({ message: "المجموعة غير موجودة" }); return; }
    const cancelled = group.cancelled_sessions ?? [];
    const updated = cancelled.includes(date)
      ? cancelled.filter((d: string) => d !== date)
      : [...cancelled, date];
    group.cancelled_sessions = updated;
    await group.save();
    res.json(group);
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء تعديل الجلسة" });
  }
};

export const updateGroupsByGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Whitelist: فقط الحقول المسموح بتعديلها بالجملة
    const allowed: Record<string, unknown> = {};
    if (req.body.sessions_per_month !== undefined) allowed.sessions_per_month = Number(req.body.sessions_per_month);
    if (req.body.monthly_price !== undefined) allowed.monthly_price = Number(req.body.monthly_price);
    if (req.body.sub_teacher_id !== undefined) allowed.sub_teacher_id = req.body.sub_teacher_id || null;
    if (Object.keys(allowed).length === 0) {
      res.status(400).json({ message: "لا توجد حقول صالحة للتحديث" }); return;
    }
    const targets = await Group.find({ grade_id: req.params.gradeId, ...teacherFilter(req) }).select("teacher_id").lean();
    if (!(await Promise.all(targets.map(g => validateOwnedReferences(String(g.teacher_id), allowed)))).every(Boolean)) { res.status(403).json({ message: "مرجع غير مصرح" }); return; }
    await Group.updateMany(
      { grade_id: req.params.gradeId, ...teacherFilter(req) },
      { $set: allowed }
    );
    res.json({ message: "تم التحديث بنجاح" });
  } catch {
    res.status(500).json({ message: "حدث خطأ أثناء التحديث" });
  }
};

export const deleteGroup = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { MonthlySubscription } = await import("../models/MonthlySubscription");
    const { AttendanceRecord } = await import("../models/AttendanceRecord");

    const group = await Group.findOne({ _id: req.params.id, ...teacherFilter(req) });
    if (!group) { res.status(404).json({ message: "المجموعة غير موجودة" }); return; }

    if (await AttendanceRecord.exists({ group_id: req.params.id, ...teacherFilter(req) })) { res.status(409).json({ message: "لا يمكن حذف مجموعة لها سجل حضور" }); return; }
    const studentIds = await Student.find(
      { group_id: req.params.id, ...teacherFilter(req) }, { _id: 1 }
    ).lean().then(s => s.map(s => s._id));

    const hasHistory = await AttendanceRecord.exists({group_id:req.params.id,...teacherFilter(req)}) || await StudentMembership.exists({group_id:req.params.id,...teacherFilter(req)});
    if(hasHistory){res.status(409).json({message:"المجموعة مرتبطة بسجل تاريخي ولا يمكن حذفها"});return;}
    await series([
      group.deleteOne(),
      Student.updateMany({ _id: { $in: studentIds } }, { $set: { group_id: null, group_join_date: null } }),
      // حذف الاشتراكات غير المدفوعة فقط — الحفاظ على السجلات المالية التاريخية
      studentIds.length
        ? MonthlySubscription.deleteMany({ student_id: { $in: studentIds }, status: { $in: ["due", "not_due"] } })
        : Promise.resolve(),
      AttendanceRecord.deleteMany({ group_id: req.params.id }),
    ]);

    res.json({ message: "تم الحذف بنجاح" });
  } catch (error: any) {
    if(error?.hasErrorLabel?.("TransientTransactionError")) throw error;
    if (!res.headersSent) res.status(500).json({ message: "حدث خطأ أثناء حذف المجموعة" });
  }
});
