import { atomicController, series } from "../services/atomicController";
import { validateOwnedReferences } from "../utils/ownedReferences";
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { QuestionBank } from "../models/QuestionBank";
import { Question } from "../models/Question";

const mapBank = (b: any) => ({
  id: b._id.toString(),
  teacher_id: b.teacher_id?.toString(),
  title: b.title,
  subject: b.subject || "",
  exam_title: b.exam_title || "",
  exam_date: b.exam_date || "",
  grade_id: b.grade_id?.toString() || null,
  group_id: b.group_id?.toString() || null,
  total_score: b.total_score ?? null,
  created_at: b.created_at,
});

export const getBanks = async (req: AuthRequest, res: Response): Promise<void> => {
  const banks = await QuestionBank.find({ teacher_id: req.user!.id }).sort({ created_at: -1 }).lean();
  res.json(banks.map(mapBank));
};

export const createBank = async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, subject, exam_title, exam_date, grade_id, group_id, total_score } = req.body;
  if (!title?.trim()) { res.status(400).json({ message: "العنوان مطلوب" }); return; }
  if (!await validateOwnedReferences(req.user!.id, { grade_id, group_id })) { res.status(403).json({ message: "المجموعة أو الصف غير متاح" }); return; }
  const bank = await QuestionBank.create({
    teacher_id: req.user!.id,
    title: title.trim(),
    subject: subject?.trim() || "",
    exam_title: exam_title?.trim() || "",
    exam_date: exam_date || "",
    grade_id: grade_id || null,
    group_id: group_id || null,
    total_score: total_score || null,
  });
  res.status(201).json(mapBank(bank.toObject()));
};

export const updateBank = async (req: AuthRequest, res: Response): Promise<void> => {
  const bank = await QuestionBank.findOne({ _id: req.params.id, teacher_id: req.user!.id });
  if (!bank) { res.status(404).json({ message: "البنك غير موجود" }); return; }
  const { title, subject, exam_title, exam_date, grade_id, group_id, total_score } = req.body;
  if (!await validateOwnedReferences(req.user!.id, { grade_id, group_id })) { res.status(403).json({ message: "المجموعة أو الصف غير متاح" }); return; }
  if (title !== undefined) bank.title = title.trim();
  if (subject !== undefined) bank.subject = subject.trim();
  if (exam_title !== undefined) bank.exam_title = exam_title.trim();
  if (exam_date !== undefined) bank.exam_date = exam_date;
  if (grade_id !== undefined) bank.grade_id = grade_id || null;
  if (group_id !== undefined) bank.group_id = group_id || null;
  if (total_score !== undefined) bank.total_score = total_score || null;
  await bank.save();
  res.json(mapBank(bank.toObject()));
};

export const deleteBank = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const bank = await QuestionBank.findOne({ _id: req.params.id, teacher_id: req.user!.id });
  if (!bank) { res.status(404).json({ message: "البنك غير موجود" }); return; }
  await series([bank.deleteOne(), Question.deleteMany({ bank_id: bank._id })]);
  res.status(204).end();
});

export const duplicateBank = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const bank = await QuestionBank.findOne({ _id: req.params.id, teacher_id: req.user!.id }).lean();
  if (!bank) { res.status(404).json({ message: "البنك غير موجود" }); return; }
  const newBank = await QuestionBank.create({
    teacher_id: req.user!.id,
    title: `${bank.title} (نسخة)`,
    subject: bank.subject || "",
    exam_title: bank.exam_title || "",
    exam_date: bank.exam_date || "",
    grade_id: bank.grade_id || null,
    group_id: bank.group_id || null,
  });
  const questions = await Question.find({ bank_id: bank._id }).lean();
  if (questions.length > 0) {
    await Question.insertMany(questions.map(q => ({
      bank_id: newBank._id,
      content: q.content,
      options: q.options,
      option_images: q.option_images || null,
      correct_answer: q.correct_answer,
      correct_answers: q.correct_answers || null,
      question_type: q.question_type,
      essay_lines: q.essay_lines,
      section_name: q.section_name,
      image_base64: q.image_base64,
      marks: q.marks ?? null,
      teacher_notes: q.teacher_notes || null,
      model_answer: q.model_answer || null,
    })));
  }
  res.status(201).json(mapBank(newBank.toObject()));
});

export const getQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  const bank = await QuestionBank.findOne({ _id: req.params.bankId, teacher_id: req.user!.id });
  if (!bank) { res.status(404).json({ message: "البنك غير موجود" }); return; }
  const questions = await Question.find({ bank_id: bank._id }).sort({ created_at: 1 }).lean();
  res.json(questions.map(q => ({ ...q, id: q._id.toString(), _id: undefined, __v: undefined })));
};

const normalizeQuestionType = (t?: string | null): "mcq" | "essay" | null => {
  if (t === "essay") return "essay";
  if (t === "mcq" || t === "single_choice" || t === "multiple_choice" || t === "true_false") return "mcq";
  return null;
};

export const createQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const bank = await QuestionBank.findOne({ _id: req.params.bankId, teacher_id: req.user!.id });
  if (!bank) { res.status(404).json({ message: "البنك غير موجود" }); return; }
  const { content, options, option_images, correct_answer, correct_answers, question_type, essay_lines, section_name, image_base64, marks, teacher_notes, model_answer } = req.body;
  if (!content?.trim()) { res.status(400).json({ message: "نص السؤال مطلوب" }); return; }
  const question = await Question.create({
    bank_id: bank._id,
    content: content.trim(),
    options,
    option_images: option_images || null,
    correct_answer,
    correct_answers: correct_answers || null,
    question_type: normalizeQuestionType(question_type),
    essay_lines,
    section_name,
    image_base64,
    marks: marks ?? null,
    teacher_notes: teacher_notes || null,
    model_answer: model_answer || null,
  });
  res.status(201).json(question);
};

export const updateQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const question = await Question.findById(req.params.id).lean();
  if (!question) { res.status(404).json({ message: "السؤال غير موجود" }); return; }
  const bank = await QuestionBank.findOne({ _id: question.bank_id, teacher_id: req.user!.id });
  if (!bank) { res.status(403).json({ message: "غير مصرح" }); return; }
  const { question_type } = req.body;
  const allowed = ["content", "options", "option_images", "correct_answer", "correct_answers", "essay_lines", "section_name", "image_base64", "marks", "teacher_notes", "model_answer"];
  const rest = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const patch = question_type !== undefined ? { ...rest, question_type: normalizeQuestionType(question_type) } : rest;
  const updated = await Question.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true, runValidators: true }).lean();
  res.json({ ...updated, id: (updated as any)._id.toString(), _id: undefined, __v: undefined });
};

export const deleteQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const question = await Question.findById(req.params.id).lean();
  if (!question) { res.status(404).json({ message: "السؤال غير موجود" }); return; }
  const bank = await QuestionBank.findOne({ _id: question.bank_id, teacher_id: req.user!.id });
  if (!bank) { res.status(403).json({ message: "غير مصرح" }); return; }
  await Question.deleteOne({ _id: question._id });
  res.status(204).end();
};
