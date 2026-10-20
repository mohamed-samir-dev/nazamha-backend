const days = new Set(["السبت", "الأحد", "الإثنين", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"]);
export function validCalendarDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function groupValidationError(data: Record<string, unknown>, partial = false): string | null {
  if ((!partial || "code" in data) && (typeof data.code !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,3}$/.test(data.code.trim()))) return "كود المجموعة مطلوب ويجب أن يبدأ بحرف ويتكون من أربعة أحرف أو أرقام كحد أقصى";
  if ((!partial || "name" in data) && (typeof data.name !== "string" || !data.name.trim())) return "اسم المجموعة مطلوب";
  if ((!partial || "day_of_week" in data) && (typeof data.day_of_week !== "string" || !data.day_of_week.trim() || !data.day_of_week.split(/[،,]/).every(day => days.has(day.trim())))) return "أيام المجموعة غير صحيحة";
  if ((!partial || "time" in data) && (typeof data.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))) return "وقت المجموعة غير صحيح";
  if ((!partial || "monthly_price" in data) && (data.monthly_price == null || !["number", "string"].includes(typeof data.monthly_price) || !Number.isFinite(Number(data.monthly_price)) || Number(data.monthly_price) <= 0)) return "سعر الاشتراك يجب أن يكون رقمًا أكبر من صفر";
  if ("sessions_per_month" in data && (!Number.isInteger(Number(data.sessions_per_month)) || Number(data.sessions_per_month) < 1)) return "عدد الحصص يجب أن يكون عددًا صحيحًا موجبًا";
  if (data.start_date != null && data.start_date !== "" && !validCalendarDate(data.start_date)) return "تاريخ البداية غير صحيح";
  return null;
}
