import mongoose, { Schema, Document } from "mongoose";

export interface IExam extends Document {
  teacher_id: mongoose.Types.ObjectId;
  group_id: mongoose.Types.ObjectId;
  bank_id?: string;
  title: string;
  max_score: number;
  exam_date: string;
  created_at: Date;
}

export interface IExamGrade extends Document {
  exam_id: mongoose.Types.ObjectId;
  student_id: mongoose.Types.ObjectId;
  score: number;
  created_at: Date;
}

const ExamSchema = new Schema<IExam>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    group_id: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    bank_id: { type: String, default: null, index: true },
    title: { type: String, required: true, trim: true },
    max_score: { type: Number, required: true, default: 100 },
    exam_date: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

const ExamGradeSchema = new Schema<IExamGrade>(
  {
    exam_id: { type: Schema.Types.ObjectId, ref: "Exam", required: true, index: true },
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    score: { type: Number, required: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

ExamGradeSchema.index({ exam_id: 1, student_id: 1 }, { unique: true });

ExamGradeSchema.index({ student_id: 1, created_at: -1 });
export const Exam = mongoose.model<IExam>("Exam", ExamSchema);
export const ExamGrade = mongoose.model<IExamGrade>("ExamGrade", ExamGradeSchema);
