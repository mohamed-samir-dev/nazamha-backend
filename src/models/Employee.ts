import mongoose, { Schema, Document } from "mongoose";

export type SalaryType =
  | "monthly"          // راتب شهري ثابت
  | "daily"            // راتب يومي
  | "hourly"           // راتب بالساعة
  | "per_lesson"       // راتب بالحصة
  | "percentage"       // نسبة من الإيراد
  | "fixed_plus_bonus"; // راتب أساسي + حوافز

export interface IEmployee extends Document {
  teacher_id: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  job_title: string;
  employment_start_date: Date;
  employment_end_date?: Date | null;
  salary_type: SalaryType;
  base_salary: number;
  payment_day: number;
  notes?: string;
  is_active: boolean;
  is_recurring: boolean;
  created_at: Date;
  updated_at: Date;
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    name: { type: String, required: [true, "اسم الموظف مطلوب"], trim: true, maxlength: [200, "الاسم لا يمكن أن يتجاوز 200 حرف"] },
    phone: { type: String, default: "", trim: true },
    job_title: { type: String, required: [true, "المسمى الوظيفي مطلوب"], trim: true, maxlength: [100, "المسمى الوظيفي لا يمكن أن يتجاوز 100 حرف"] },
    employment_start_date: { type: Date, required: [true, "تاريخ بدء العمل مطلوب"] },
    employment_end_date: { type: Date, default: null },
    salary_type: {
      type: String,
      enum: ["monthly", "daily", "hourly", "per_lesson", "percentage", "fixed_plus_bonus"],
      default: "monthly",
      required: true,
    },
    base_salary: {
      type: Number,
      required: [true, "الراتب الأساسي مطلوب"],
      min: [0, "الراتب لا يمكن أن يكون سالباً"],
      max: [10_000_000, "المبلغ يتجاوز الحد الأقصى"],
    },
    payment_day: {
      type: Number,
      min: [1, "يوم الدفع يجب أن يكون بين 1 و 31"],
      max: [31, "يوم الدفع يجب أن يكون بين 1 و 31"],
      default: 1,
    },
    notes: { type: String, default: "", maxlength: [1000, "الملاحظات لا يمكن أن تتجاوز 1000 حرف"] },
    is_active: { type: Boolean, default: true, index: true },
    is_recurring: { type: Boolean, default: true },
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

EmployeeSchema.index({ teacher_id: 1, is_active: 1 });
EmployeeSchema.index({ teacher_id: 1, name: 1 });

export const Employee = mongoose.model<IEmployee>("Employee", EmployeeSchema);
