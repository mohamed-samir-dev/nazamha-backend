export function validStudentName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= 120 &&
    /^[\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+)+$/u.test(value.trim());
}
