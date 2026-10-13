import { atomicController, series } from "../services/atomicController";
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { QuestionBank } from "../models/QuestionBank";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { Exam, ExamGrade } from "../models/Exam";

const mapExam = (e: any) => ({
  id: e._id.toString(),
  teacher_id: e.teacher_id?.toString(),
  group_id: e.group_id?.toString(),
  bank_id: e.bank_id || null,
  title: e.title,
  max_score: e.max_score,
  exam_date: e.exam_date || "",
  created_at: e.created_at,
});

export const findOrCreateByBank = async (req: AuthRequest, res: Response): Promise<void> => {
  const { bank_id, group_id, title, max_score, exam_date } = req.body;
  if (max_score !== undefined && (!Number.isFinite(max_score) || max_score <= 0)) { res.status(400).json({ message: "الدرجة النهائية غير صالحة" }); return; }
  if (!bank_id || !group_id || !title) { res.status(400).json({ message: "البيانات ناقصة" }); return; }
  if (!await Group.exists({ _id: group_id, teacher_id: req.user!.id }) || !await QuestionBank.exists({ _id: bank_id, teacher_id: req.user!.id })) { res.status(403).json({ message: "المجموعة أو بنك الأسئلة غير متاح" }); return; }
  let exam = await Exam.findOne({ bank_id, group_id, teacher_id: req.user!.id });
  if (!exam) {
    exam = await Exam.create({
      teacher_id: req.user!.id,
      group_id,
      bank_id,
      title: title.trim(),
      max_score: max_score || 100,
      exam_date: exam_date || "",
    });
  }
  res.json(mapExam(exam.toObject()));
};

export const getExams = async (req: AuthRequest, res: Response): Promise<void> => {
  const { group_id } = req.query;
  const filter: any = { teacher_id: req.user!.id };
  if (group_id) filter.group_id = group_id;
  const exams = await Exam.find(filter).sort({ created_at: -1 }).lean();
  res.json(exams.map(mapExam));
};

export const createExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const { group_id, title, max_score, exam_date } = req.body;
  if (max_score !== undefined && (!Number.isFinite(max_score) || max_score <= 0)) { res.status(400).json({ message: "الدرجة النهائية غير صالحة" }); return; }
  if (!title?.trim() || !group_id) { res.status(400).json({ message: "البيانات ناقصة" }); return; }
  if (!await Group.exists({ _id: group_id, teacher_id: req.user!.id })) { res.status(403).json({ message: "المجموعة غير متاحة" }); return; }
  const exam = await Exam.create({
    teacher_id: req.user!.id,
    group_id,
    title: title.trim(),
    max_score: max_score || 100,
    exam_date: exam_date || "",
  });
  res.status(201).json(mapExam(exam.toObject()));
};

export const updateExam = async (req: AuthRequest, res: Response): Promise<void> => {
  const exam = await Exam.findOne({ _id: req.params.id, teacher_id: req.user!.id });
  if (!exam) { res.status(404).json({ message: "الامتحان غير موجود" }); return; }
  const { title, max_score, exam_date } = req.body;
  if (title !== undefined) exam.title = title.trim();
  if (max_score !== undefined) {
    if (!Number.isFinite(max_score) || max_score <= 0 || await ExamGrade.exists({ exam_id: exam._id, score: { $gt: max_score } })) { res.status(400).json({ message: "الدرجة النهائية غير صالحة أو أقل من درجات مسجلة" }); return; }
    exam.max_score = max_score;
  }
  if (exam_date !== undefined) exam.exam_date = exam_date;
  await exam.save();
  res.json(mapExam(exam.toObject()));
};

export const deleteExam = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const exam = await Exam.findOne({ _id: req.params.id, teacher_id: req.user!.id });
  if (!exam) { res.status(404).json({ message: "الامتحان غير موجود" }); return; }
  await series([exam.deleteOne(), ExamGrade.deleteMany({ exam_id: exam._id })]);
  res.status(204).end();
});

export const getStudentExams = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  // تحقق من ownership قبل جلب أي بيانات
  const { Student: S } = await import("../models/Student");
  const student = await S.findOne({ _id: studentId, teacher_id: req.user!.id }).lean();
  if (!student) { res.status(403).json({ message: "غير مصرح" }); return; }

  const grades = await ExamGrade.find({ student_id: studentId }).lean();
  if (grades.length === 0) { res.json([]); return; }
  const examIds = [...new Set(grades.map((g) => g.exam_id.toString()))];
  const exams = await Exam.find({ _id: { $in: examIds }, teacher_id: req.user!.id }).lean();
  const gradeMap = new Map(grades.map((g) => [g.exam_id.toString(), g]));
  res.json(exams.map((e) => {
    const g = gradeMap.get(e._id.toString());
    return { ...mapExam(e), score: g?.score ?? null, grade_id: g?._id.toString() };
  }));
};

// جلب كل درجات كل الطلاب للمعلم دفعة واحدة
export const getAllStudentsExamGrades = async (req: AuthRequest, res: Response): Promise<void> => {
  const exams = await Exam.find({ teacher_id: req.user!.id }).lean();
  if (exams.length === 0) { res.json({}); return; }
  const examIds = exams.map((e) => e._id);
  const allGrades = await ExamGrade.find({ exam_id: { $in: examIds } }).lean();
  const examMap = new Map(exams.map((e) => [e._id.toString(), e]));
  // group by student_id: { studentId -> [{ exam, score }] }
  const result: Record<string, any[]> = {};
  for (const g of allGrades) {
    const sid = g.student_id.toString();
    const exam = examMap.get(g.exam_id.toString());
    if (!exam) continue;
    if (!result[sid]) result[sid] = [];
    result[sid].push({ ...mapExam(exam), score: g.score });
  }
  res.json(result);
};

export const getGrades = async (req: AuthRequest, res: Response): Promise<void> => {
  const exam = await Exam.findOne({ _id: req.params.examId, teacher_id: req.user!.id });
  if (!exam) { res.status(404).json({ message: "الامتحان غير موجود" }); return; }
  const grades = await ExamGrade.find({ exam_id: exam._id }).lean();
  res.json(grades.map(g => ({ id: g._id.toString(), exam_id: g.exam_id.toString(), student_id: g.student_id.toString(), score: g.score, created_at: g.created_at })));
};

export const upsertGrades = async (req: AuthRequest, res: Response): Promise<void> => {
  const exam = await Exam.findOne({ _id: req.params.examId, teacher_id: req.user!.id });
  if (!exam) { res.status(404).json({ message: "الامتحان غير موجود" }); return; }
  const { grades } = req.body as { grades: { student_id: string; score: number }[] };
  if (!Array.isArray(grades)) { res.status(400).json({ message: "grades مطلوب" }); return; }
  if (grades.length === 0) { res.json({ message: "تم الحفظ" }); return; }

  // Single bulkWrite instead of N concurrent findOneAndUpdate calls.
  // Preserves upsert semantics: inserts if not exists, updates if exists.
  const ids = [...new Set(grades.map(g => g.student_id))];
  if (ids.length !== grades.length || grades.some(g => !Number.isFinite(g.score) || g.score < 0 || g.score > exam.max_score)) { res.status(400).json({ message: "درجات غير صالحة أو طلاب مكررون" }); return; }
  const owned = await Student.countDocuments({ _id: { $in: ids }, teacher_id: req.user!.id, group_id: exam.group_id });
  if (owned !== ids.length) { res.status(403).json({ message: "بعض الطلاب لا ينتمون للمجموعة" }); return; }
  const ops = grades.map((g) => ({
    updateOne: {
      filter: { exam_id: exam._id, student_id: g.student_id },
      update: { $set: { score: g.score } },
      upsert: true,
    },
  }));
  await ExamGrade.bulkWrite(ops, { ordered: false });
  res.json({ message: "تم الحفظ" });
};
