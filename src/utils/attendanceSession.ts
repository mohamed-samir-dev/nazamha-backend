import { buildLocalDate, getTodayInTimezone } from "./timezoneUtils";
const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const normalizeDay = (day: string) => day.replace(/[أإآ]/g, "ا").trim();
export function scheduledOn(group: { day_of_week?: string }, date: string) {
  if (!group.day_of_week) return true; // legacy imported groups
  return group.day_of_week.split(/[,،\s]+/).map(normalizeDay).includes(normalizeDay(days[new Date(date + "T12:00:00Z").getUTCDay()]));
}
export function validAttendanceDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date <= getTodayInTimezone();
}
export function endedSession(group: { day_of_week?: string; time?: string; start_date?: string | null; cancelled_sessions?: string[] }, date: string, now = new Date()) {
  return validAttendanceDate(date) && scheduledOn(group, date) && (!group.start_date || date >= group.start_date) && !group.cancelled_sessions?.includes(date) && now.getTime() >= buildLocalDate(date, group.time || "23:59").getTime() + 3600000;
}
