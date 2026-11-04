import mongoose, { Schema, Document } from "mongoose";

export type RecurringType = "salary" | "expense";
export type RecurringFrequency = "monthly" | "weekly" | "quarterly" | "semi_annual" | "yearly";
export type RecurringStatus = "active" | "paused" | "stopped";

export interface IRecurringTransaction extends Document {
  teacher_id: mongoose.Types.ObjectId;
  title: string;
  type: RecurringType;
  employee_id?: mongoose.Types.ObjectId | null;
  category: string;
  amount: number;
  frequency: RecurringFrequency;
  start_date: Date;
  end_date?: Date | null;
  due_day: number;
  payment_method_preference?: string;
  notes?: string;
  status: RecurringStatus;
  last_generated_period?: string;
  created_at: Date;
  updated_at: Date;
}

const RecurringTransactionSchema = new Schema<IRecurringTransaction>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    title: { type: String, required: [true, "اسم المعاملة المتكررة مطلوب"], trim: true, maxlength: [200, "العنوان لا يمكن أن يتجاوز 200 حرف"] },
    type: { type: String, enum: ["salary", "expense"], required: true, index: true },
    employee_id: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    category: { type: String, default: "other", trim: true },
    amount: {
      type: Number,
      required: [true, "المبلغ مطلوب"],
      min: [0, "المبلغ لا يمكن أن يكون سالباً"],
      max: [10_000_000, "المبلغ يتجاوز الحد الأقصى"],
    },
    frequency: {
      type: String,
      enum: ["monthly", "weekly", "quarterly", "semi_annual", "yearly"],
      default: "monthly",
      required: true,
    },
    start_date: { type: Date, required: [true, "تاريخ البدء مطلوب"] },
    end_date: { type: Date, default: null },
    due_day: { type: Number, min: 1, max: 31, default: 1 },
    payment_method_preference: { type: String, default: "cash" },
    notes: { type: String, default: "", maxlength: [1000, "الملاحظات لا يمكن أن تتجاوز 1000 حرف"] },
    status: { type: String, enum: ["active", "paused", "stopped"], default: "active", index: true },
    last_generated_period: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

RecurringTransactionSchema.index({ teacher_id: 1, status: 1 });
RecurringTransactionSchema.index({ teacher_id: 1, type: 1 });
RecurringTransactionSchema.index({ teacher_id: 1, employee_id: 1, type: 1 });

export const RecurringTransaction = mongoose.model<IRecurringTransaction>("RecurringTransaction", RecurringTransactionSchema);
