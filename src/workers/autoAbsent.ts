import { withJobLease } from "../services/jobLease";
import { eligibleForSession } from "../utils/sessionEligibility";
import { buildLocalDate, getTodayInTimezone, getDayOfWeekInTimezone } from "../utils/timezoneUtils";
export function scheduleAutoAbsent() {
  const DAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  // Concurrency guard: prevents a new run from starting before the previous one finishes.
  // Without this, if a run takes > 60 s (e.g. large dataset + slow MongoDB), the next
  // setInterval tick would launch a second concurrent run, doubling DB load.
  let isRunning = false;

  const execute = async () => {
    if (isRunning) {
      console.log("[cron:auto-absent] previous run still in progress, skipping");
      return;
    }
    isRunning = true;
    try {
      const { Group } = await import("../models/Group");
      const { Student } = await import("../models/Student");
      const { AttendanceRecord } = await import("../models/AttendanceRecord");

      const now = new Date();
      // استخدم timezone صريح بدل UTC الخاص بالسيرفر
      const todayStr = getTodayInTimezone();
      const todayDayIndex = getDayOfWeekInTimezone();

      const todayAr = DAYS_AR[todayDayIndex];
      const groups = await (Group as any)
        .find({ day_of_week: { $regex: todayAr, $options: "i" } })
        .lean();

      const eligibleSessions: { group_id: string; session_date: string; teacher_id: string }[] = [];

      for (const group of groups) {
        const groupDays = (group.day_of_week as string)
          .split(/\s*[,،]\s*|\s+/)
          .map((d: string) => d.trim())
          .filter(Boolean);
        const dayIndices = groupDays.map((d: string) => DAYS_AR.indexOf(d)).filter((i: number) => i !== -1);
        if (!dayIndices.includes(todayDayIndex)) continue;

        if (!eligibleForSession(group, {}, todayStr)) continue;

        const teacherTz = (group as any).teacher_timezone || "Africa/Cairo";
        const threshold = buildLocalDate(todayStr, group.time as string, teacherTz);
        threshold.setTime(threshold.getTime() + 60 * 60 * 1000);
        if (now < threshold) continue;

        eligibleSessions.push({
          group_id: String(group._id),
          session_date: todayStr,
          teacher_id: String(group.teacher_id),
        });
      }

      if (eligibleSessions.length === 0) return;

      const groupIds = eligibleSessions.map((s) => s.group_id);

      const [allStudents, existingRecords] = await Promise.all([
        (Student as any).find({ group_id: { $in: groupIds } }).lean(),
        (AttendanceRecord as any).find({
          group_id: { $in: groupIds },
          session_date: todayStr,
        }).lean().select("student_id session_date"),
      ]);

      const existingSet = new Set(
        existingRecords.map((r: any) => `${String(r.student_id)}|${r.session_date}`)
      );

      const studentsByGroup = new Map<string, any[]>();
      for (const student of allStudents) { const key=String(student.group_id); const list=studentsByGroup.get(key)||[]; list.push(student); studentsByGroup.set(key,list); }
      const toInsert: object[] = [];
      for (const { group_id, session_date, teacher_id } of eligibleSessions) {
        const groupStudents = studentsByGroup.get(group_id) || [];
        for (const s of groupStudents) {
          if (eligibleForSession({}, s, session_date) && !existingSet.has(`${String(s._id)}|${session_date}`)) {
            toInsert.push({
              student_id: s._id,
              group_id,
              teacher_id,
              session_date,
              month: parseInt(session_date.split("-")[1], 10),
              year: parseInt(session_date.split("-")[0], 10),
              status: "absent",
            });
          }
        }
      }

      if (toInsert.length > 0) {
        await (AttendanceRecord as any).insertMany(toInsert, { ordered: false });
        console.log(`[cron:auto-absent] Marked ${toInsert.length} students absent`);
      }
    } catch (err: any) {
      if (err?.code !== 11000) {
        console.error("[cron:auto-absent] error:", err);
      }
    } finally {
      // Always release the lock, even if an error occurred
      isRunning = false;
    }
  };

  const run = () => withJobLease("auto-absent", execute).catch(error => console.error("[auto-absent]", error.message));
  void run();
  const timer = setInterval(run, 60_000);
  return () => clearInterval(timer);
}
