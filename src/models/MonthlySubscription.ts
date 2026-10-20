import mongoose, { Schema, Document } from "mongoose";

export type SubscriptionStatus = "not_due" | "due" | "paid" | "exempt";

export interface IMonthlySubscription extends Document {
  student_id: mongoose.Types.ObjectId;
  teacher_id: mongoose.Types.ObjectId;
  month: number; // 1-12
  year: number;
  status: SubscriptionStatus;
  amount: number;
  discount: number;
  paid_at?: Date | null;
  receipt_number?: string | null;
  notes?: string | null;
}

const MonthlySubscriptionSchema = new Schema<IMonthlySubscription>(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    status: { type: String, enum: ["not_due", "due", "paid", "exempt"], default: "due" },
    amount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    paid_at: { type: Date, default: null },
    receipt_number: { type: String, default: null },
    notes: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

MonthlySubscriptionSchema.index({ student_id: 1, month: 1, year: 1 }, { unique: true });
MonthlySubscriptionSchema.index({ teacher_id: 1, month: 1, year: 1 });
// NEW: year-scoped financial report query: teacher + year (for getAllTeacherSubscriptions?year=)
MonthlySubscriptionSchema.index({ teacher_id: 1, year: 1 });
// batch query: teacher + multiple students
MonthlySubscriptionSchema.index({ teacher_id: 1, student_id: 1 });
MonthlySubscriptionSchema.index({ teacher_id: 1, student_id: 1, year: 1 });
// auto-suspend query: teacher + status
MonthlySubscriptionSchema.index({ teacher_id: 1, status: 1 });
// financial report date-range query: teacher + status + paid_at
MonthlySubscriptionSchema.index({ teacher_id: 1, status: 1, paid_at: 1 });

export const MonthlySubscription = mongoose.model<IMonthlySubscription>("MonthlySubscription", MonthlySubscriptionSchema);
