import mongoose, { Schema, Document } from "mongoose";

export interface IBillTemplate extends Document {
  teacher_id: mongoose.Types.ObjectId;
  title: string;
  amount: number;
  category: "إيجار" | "رواتب سكرتارية" | "أخرى";
  is_active: boolean;
  end_month?: number | null;
  end_year?: number | null;
  created_at: Date;
}

const BillTemplateSchema = new Schema<IBillTemplate>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: [0, "المبلغ لا يمكن أن يكون سالباً"], max: [10_000_000, "المبلغ يتجاوز الحد المسموح به"] },
    category: { type: String, enum: ["إيجار", "رواتب سكرتارية", "أخرى"], required: true },
    is_active: { type: Boolean, default: true },
    end_month: { type: Number, default: null, min: [1, "الشهر يجب أن يكون بين 1 و 12"], max: [12, "الشهر يجب أن يكون بين 1 و 12"] },
    end_year: { type: Number, default: null, min: [2000, "السنة غير صالحة"], max: [2100, "السنة غير صالحة"] },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

BillTemplateSchema.index({ teacher_id: 1 });

export const BillTemplate = mongoose.model<IBillTemplate>("BillTemplate", BillTemplateSchema);
