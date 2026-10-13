/** Read-only deployment check. Never creates/drops indexes or rewrites records. */
import "dotenv/config";
import mongoose from "mongoose";
import { Student } from "../src/models/Student";
import { StudentMembership } from "../src/models/StudentMembership";
import { TeacherExpense } from "../src/models/TeacherExpense";
import { Salary } from "../src/models/Salary";
import { CenterStudent } from "../src/models/CenterStudent";
import { ExamGrade } from "../src/models/Exam";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const duplicateCodes = await Student.aggregate([
    { $match: { code: { $type: "string", $ne: "" } } },
    { $group: { _id: { teacher_id: "$teacher_id", code: "$code" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }, { $count: "count" },
  ]);
  const legacyExpenses = await TeacherExpense.countDocuments({ is_virtual_instance: true, template_id: null });
  const legacySalaries = await Salary.countDocuments({ is_virtual_instance: true, template_id: null });
  const indexes = [];
  for (const model of [Student, StudentMembership, TeacherExpense, Salary, CenterStudent, ExamGrade]) {
    const diff = await (model as any).diffIndexes();
    indexes.push({ collection: model.collection.name, proposedAdditions: diff.toCreate, reviewOnlyRemovals: diff.toDrop });
  }
  console.log(JSON.stringify({ readOnly: true, duplicateStudentCodeGroups: duplicateCodes[0]?.count || 0, legacyExpenses, legacySalaries, indexes }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
