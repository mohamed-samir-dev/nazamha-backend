import mongoose, { Schema, Document } from "mongoose";

export interface IQuestion extends Document {
  bank_id: mongoose.Types.ObjectId;
  content: string;
  options?: string[] | null;
  option_images?: (string | null)[] | null;
  correct_answer?: string | null;
  correct_answers?: string[] | null;
  question_type?: "mcq" | "essay" | null;
  essay_lines?: number | null;
  section_name?: string | null;
  image_base64?: string | null;
  marks?: number | null;
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
    question_type: { type: String, enum: ["mcq", "essay", null], default: null },
    essay_lines: { type: Number, default: null },
    section_name: { type: String, default: null, trim: true },
    image_base64: { type: String, default: null },
    marks: { type: Number, default: null },
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

export const Question = mongoose.model<IQuestion>("Question", QuestionSchema);
