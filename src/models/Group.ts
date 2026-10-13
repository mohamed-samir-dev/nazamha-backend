import mongoose, { Schema, Document } from "mongoose";

export interface IGroup extends Document {
  name: string;
  code?: string;
  day_of_week: string;
  time: string;
  is_private?: boolean;
  teacher_id: mongoose.Types.ObjectId;
  sub_teacher_id?: mongoose.Types.ObjectId | null;
  grade_id?: mongoose.Types.ObjectId | null;
  sessions_per_month?: number;
  monthly_price?: number | null;
  cancelled_sessions?: string[];
  start_date?: string | null; // YYYY-MM-DD
  whatsapp_link?: string | null;
  created_at: Date;
}

const GroupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true },
    day_of_week: { type: String, required: true },
    time: { type: String, required: true },
    is_private: { type: Boolean, default: false },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    sub_teacher_id: { type: Schema.Types.ObjectId, ref: "SubTeacher", default: null },
    grade_id: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
    sessions_per_month: { type: Number, default: 4 },
    monthly_price: { type: Number, default: null },
    cancelled_sessions: { type: [String], default: [] },
    start_date: { type: String, default: null },
    whatsapp_link: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

GroupSchema.index({ teacher_id: 1 });
GroupSchema.index({ teacher_id: 1, code: 1 }, { unique: true, sparse: true });
GroupSchema.index({ day_of_week: 1 }); // helps cron filter

// ── Performance indexes (P3) ──────────────────────────────────────────────────
// Compound index for cron scheduling: find groups for a teacher on a given day
GroupSchema.index({ teacher_id: 1, day_of_week: 1 });

export const Group = mongoose.model<IGroup>("Group", GroupSchema);
