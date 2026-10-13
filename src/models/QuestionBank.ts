import mongoose, { Schema, Document } from "mongoose";

export interface IQuestionBank extends Document {
  teacher_id: mongoose.Types.ObjectId;
  title: string;
  subject?: string;
  exam_title?: string;
  exam_date?: string;
  grade_id?: mongoose.Types.ObjectId | null;
  group_id?: mongoose.Types.ObjectId | null;
  total_score?: number | null;
  created_at: Date;
}

const QuestionBankSchema = new Schema<IQuestionBank>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    title: { type: String, required: true, trim: true },
    subject: { type: String, trim: true, default: "" },
    exam_title: { type: String, trim: true, default: "" },
    exam_date: { type: String, default: "" },
    grade_id: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
    group_id: { type: Schema.Types.ObjectId, ref: "Group", default: null },
    total_score: { type: Number, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

export const QuestionBank = mongoose.model<IQuestionBank>("QuestionBank", QuestionBankSchema);
