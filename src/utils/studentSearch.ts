export function normalizeStudentCodeSearch(value: string): string {
  return value.normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[٠-٩۰-۹]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit) >= 0 ? "٠١٢٣٤٥٦٧٨٩".indexOf(digit) : "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .trim().replace(/\s*-\s*/g, "-");
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function studentSearchFilter(value: string): Record<string, unknown> {
  const name = value.trim();
  if (!name) return {};
  const code = escape(normalizeStudentCodeSearch(value));
  return { $or: [
    { name: { $regex: escape(name), $options: "i" } },
    { code: { $regex: code, $options: "i" } },
    { center_student_code: { $regex: code, $options: "i" } },
  ] };
}
