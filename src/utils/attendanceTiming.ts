import { buildLocalDate } from "./timezoneUtils";

/** Arrival reported by an offline device never determines lateness. */
export function attendanceTiming(lesson: {session_date:string;time:string;grace_minutes?:number}, source:string, now = new Date()) {
  const live = source === "qr" || source === "manual";
  const late = live ? Math.max(0, Math.ceil((now.getTime() - buildLocalDate(lesson.session_date, lesson.time).getTime()) / 60000) - (lesson.grace_minutes || 0)) : null;
  return { received_at: now, arrived_at: live ? now : null, late_minutes: late, timing_state: live ? (late! > 0 ? "late" : "on_time") : "unverified" };
}

export function assertAttendanceWindow(lesson:{state:string;opens_at:Date;closes_at:Date}, now = new Date()) {
  if (lesson.state !== "open") throw new Error("الحصة غير مفتوحة لتسجيل الحضور");
  if (now < new Date(lesson.opens_at) || now > new Date(lesson.closes_at)) throw new Error("الوقت خارج نافذة حضور الحصة؛ استخدم التصحيح بسبب واضح");
}
