import mongoose, { Schema, Document } from "mongoose";

export interface IBill extends Document {
  title: string;
  amount: number;
  category: "إيجار" | "رواتب سكرتارية" | "أخرى";
  billing_month: number;
  billing_year: number;
  is_recurring: boolean;
  template_id?: string;
  teacher_id: mongoose.Types.ObjectId;
  created_at: Date;
}

const BillSchema = new Schema<IBill>(
  {
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: [0, "المبلغ لا يمكن أن يكون سالباً"], max: [10_000_000, "المبلغ يتجاوز الحد المسموح به"] },
    category: { type: String, enum: ["إيجار", "رواتب سكرتارية", "أخرى"], required: true },
    billing_month: { type: Number, required: true, min: [1, "الشهر يجب أن يكون بين 1 و 12"], max: [12, "الشهر يجب أن يكون بين 1 و 12"] },
    billing_year: { type: Number, required: true, min: [2000, "السنة غير صالحة"], max: [2100, "السنة غير صالحة"], default: () => new Date().getFullYear() },
    is_recurring: { type: Boolean, default: false },
    template_id: { type: String, default: null },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

// Primary lookup: teacher + year + month (most common financial query pattern)
BillSchema.index({ teacher_id: 1, billing_year: 1, billing_month: 1 });
// For recurring bill generation: teacher + is_recurring
BillSchema.index({ teacher_id: 1, is_recurring: 1 });
// For year-scoped list without month: teacher + year descending
BillSchema.index({ teacher_id: 1, billing_year: -1 });

export const Bill = mongoose.model<IBill>("Bill", BillSchema);
