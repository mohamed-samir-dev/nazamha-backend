import { Group } from "../models/Group";
import { Grade } from "../models/Grade";
import { SubTeacher } from "../models/SubTeacher";
export async function validateOwnedReferences(teacherId: string, data: Record<string, unknown>): Promise<boolean> {
  const checks: Promise<unknown>[] = [];
  if (data.group_id) checks.push(Group.exists({ _id: data.group_id, teacher_id: teacherId }));
  if (data.grade_id) checks.push(Grade.exists({ _id: data.grade_id, teacher_id: teacherId }));
  if (data.sub_teacher_id) checks.push(SubTeacher.exists({ _id: data.sub_teacher_id, center_id: teacherId }));
  for (const check of checks) if (!await check) return false;
  return true;
}

export async function groupMatchesGrade(teacherId: string, groupId: unknown, gradeId: unknown): Promise<boolean> {
  if (!groupId) return true;
  const group = await Group.findOne({ _id: groupId, teacher_id: teacherId }).lean();
  return !!group && !!gradeId && String(group.grade_id) === String(gradeId);
}

export function validStudentDiscounts(data: Record<string, unknown>): boolean {
  return ["discount_value", "book_discount_value", "family_discount_percent", "family_book_discount_percent"].every(key => {
    const value = data[key];
    return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
  });
}
