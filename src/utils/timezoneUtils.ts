/**
 * timezoneUtils — تحويل التواريخ والأوقات بشكل صريح حسب timezone المدرس.
 * الـ default هو Africa/Cairo (UTC+2 شتاء / UTC+3 صيف).
 *
 * السبب: new Date("2024-09-15T14:00:00") بدون suffix يُفسَّر كـ local time
 * في Node.js — وعلى سيرفر UTC يعطي نتيجة خاطئة بفارق 2-3 ساعات.
 */

const DEFAULT_TZ = "Africa/Cairo";

/**
 * يُنشئ Date object من تاريخ (YYYY-MM-DD) ووقت (HH:MM) في timezone محدد.
 * يستخدم Intl.DateTimeFormat لحساب الـ offset الصحيح بدون hardcode.
 */
export function buildLocalDate(dateStr: string, timeStr: string, timezone = DEFAULT_TZ): Date {
  // بناء ISO string مؤقت بـ UTC ثم تصحيح الـ offset
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  // نبني Date مؤقت بـ UTC
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // نحسب الـ offset الفعلي لهذا الـ timezone في هذا التاريخ
  const offset = getTimezoneOffsetMs(utcDate, timezone);

  // نطرح الـ offset للحصول على الـ UTC الصحيح
  return new Date(utcDate.getTime() - offset);
}

/**
 * يُرجع الـ offset بالـ milliseconds بين UTC والـ timezone المحدد
 * في لحظة زمنية معينة (يأخذ DST بعين الاعتبار).
 */
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr  = date.toLocaleString("en-US", { timeZone: timezone });
  const utcMs  = new Date(utcStr).getTime();
  const tzMs   = new Date(tzStr).getTime();
  return tzMs - utcMs;
}

/**
 * يُرجع تاريخ اليوم (YYYY-MM-DD) في timezone محدد.
 */
export function getTodayInTimezone(timezone = DEFAULT_TZ): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * يُرجع رقم اليوم في الأسبوع (0=Sunday) في timezone محدد.
 */
export function getDayOfWeekInTimezone(timezone = DEFAULT_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).formatToParts(new Date());
  const dayStr = parts.find(p => p.type === "weekday")?.value || "";
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? new Date().getDay();
}
