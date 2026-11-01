import mongoose, { Schema, Document } from "mongoose";

export type QuestionType = "single_choice" | "multiple_choice" | "true_false" | "essay" | "mcq";

export interface IQuestion extends Document {
  bank_id: mongoose.Types.ObjectId;
  content: string;
  options?: string[] | null;
  option_images?: (string | null)[] | null;
  correct_answer?: string | null;
  correct_answers?: string[] | null;
  question_type?: QuestionType | null;
  essay_lines?: number | null;
  section_name?: string | null;
  image_base64?: string | null;
  marks?: number | null;
  order?: number;
  teacher_notes?: string | null;
  model_answer?: string | null;
  created_at: Date;
}

const QuestionSchema = new Schema<IQuestion>(
  {
    bank_id: { type: Schema.Types.ObjectId, ref: "QuestionBank", required: true, index: true },
    content: { type: String, required: true, trim: true },
    options: { type: [String], default: null },
    option_images: { type: Schema.Types.Mixed, default: null },
    correct_answer: { type: String, default: null },
    correct_answers: { type: [String], default: null },
    question_type: {
      type: String,
      enum: ["single_choice", "multiple_choice", "true_false", "essay", "mcq", null],
      default: "single_choice",
    },
    essay_lines: { type: Number, default: null },
    section_name: { type: String, default: null, trim: true },
    image_base64: { type: String, default: null },
    marks: { type: Number, default: null },
    order: { type: Number, default: 0, index: true },
    teacher_notes: { type: String, default: null },
    model_answer: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

QuestionSchema.index({ bank_id: 1, order: 1, created_at: 1 });

export const Question = mongoose.model<IQuestion>("Question", QuestionSchema);
