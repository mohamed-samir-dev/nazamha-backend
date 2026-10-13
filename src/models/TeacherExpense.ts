import mongoose, { Schema, Document } from "mongoose";

export interface ITeacherExpense extends Document {
  title: string;
  expense_type: "rent" | "utilities" | "maintenance" | "supplies" | "transport" | "food" | "other";
  category: string; // تصنيف فرعي اختياري (كهرباء، ماء، إنترنت، الخ)
  amount: number;
  month: number;
  year: number;
  is_recurring: boolean;
  start_month?: number;
  start_year?: number;
  end_month?: number | null;
  end_year?: number | null;
  payment_method?: "cash" | "bank_transfer" | "card" | "other";
  payment_status: "paid" | "pending" | "overdue";
  paid_date?: Date | null;
  notes?: string;
  attachments?: string[]; // روابط للملفات المرفقة (إيصالات، فواتير)
  is_virtual_instance?: boolean;
  template_id?: mongoose.Types.ObjectId;
  teacher_id: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const TeacherExpenseSchema = new Schema<ITeacherExpense>(
  {
    title: { 
      type: String, 
      required: true, 
      trim: true,
      maxlength: [200, "العنوان لا يمكن أن يتجاوز 200 حرف"]
    },
    expense_type: { 
      type: String, 
      required: true,
      enum: {
        values: ["rent", "utilities", "maintenance", "supplies", "transport", "food", "other"],
        message: "نوع المصروف غير صالح"
      }
    },
    category: { 
      type: String, 
      default: "",
      trim: true,
      maxlength: [100, "التصنيف لا يمكن أن يتجاوز 100 حرف"]
    },
    amount: { 
      type: Number, 
      required: true, 
      min: [0, "المبلغ لا يمكن أن يكون سالباً"], 
      max: [10_000_000, "المبلغ يتجاوز الحد المسموح به"] 
    },
    month: { 
      type: Number, 
      required: true, 
      min: [1, "الشهر يجب أن يكون بين 1 و 12"], 
      max: [12, "الشهر يجب أن يكون بين 1 و 12"] 
    },
    year: { 
      type: Number, 
      required: true, 
      min: [2000, "السنة غير صالحة"], 
      max: [2100, "السنة غير صالحة"] 
    },
    is_recurring: { 
      type: Boolean, 
      default: false 
    },
    start_month: { 
      type: Number, 
      default: null, 
      min: [1, "الشهر يجب أن يكون بين 1 و 12"], 
      max: [12, "الشهر يجب أن يكون بين 1 و 12"] 
    },
    start_year: { 
      type: Number, 
      default: null, 
      min: [2000, "السنة غير صالحة"], 
      max: [2100, "السنة غير صالحة"] 
    },
    end_month: { 
      type: Number, 
      default: null, 
      min: [1, "الشهر يجب أن يكون بين 1 و 12"], 
      max: [12, "الشهر يجب أن يكون بين 1 و 12"] 
    },
    end_year: { 
      type: Number, 
      default: null, 
      min: [2000, "السنة غير صالحة"], 
      max: [2100, "السنة غير صالحة"] 
    },
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "card", "other"],
      default: "cash"
    },
    payment_status: {
      type: String,
      required: true,
      enum: ["paid", "pending", "overdue"],
      default: "pending"
    },
    paid_date: {
      type: Date,
      default: null
    },
    notes: { 
      type: String, 
      default: "",
      maxlength: [1000, "الملاحظات لا يمكن أن تتجاوز 1000 حرف"]
    },
    attachments: {
      type: [String],
      default: []
    },
    is_virtual_instance: {
      type: Boolean,
      default: false
    },
    template_id: { type: Schema.Types.ObjectId, ref: "TeacherExpense", default: null },
    teacher_id: { 
      type: Schema.Types.ObjectId, 
      ref: "Teacher", 
      required: true,
      index: true
    },
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

// Indexes لتحسين الأداء
TeacherExpenseSchema.index({ teacher_id: 1, year: 1, month: 1 });
TeacherExpenseSchema.index({ teacher_id: 1, expense_type: 1 });
TeacherExpenseSchema.index({ teacher_id: 1, payment_status: 1 });
TeacherExpenseSchema.index({ teacher_id: 1, is_recurring: 1, start_year: 1 });

TeacherExpenseSchema.index({ template_id: 1, year: 1, month: 1 }, { unique: true, partialFilterExpression: { template_id: { $type: "objectId" } } });
export const TeacherExpense = mongoose.model<ITeacherExpense>("TeacherExpense", TeacherExpenseSchema);
