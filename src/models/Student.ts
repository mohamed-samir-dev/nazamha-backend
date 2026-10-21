import mongoose, { Schema, Document } from "mongoose";
import { studentCardToken } from "../utils/studentCard";

export interface IStudent extends Document {
  mutation_version?: number;
  card_qr_version?: number;
  name: string;
  code?: string;
  group_id: mongoose.Types.ObjectId | null;
  grade_id?: mongoose.Types.ObjectId | null;
  teacher_id: mongoose.Types.ObjectId;
  /** Legacy display field. Payment status is authoritative in MonthlySubscription. */
  months?: boolean[];
  received_books?: string[];
  discount_value?: number;
  discount_reason?: string;
  apply_discount_to_books?: boolean;
  book_discount_value?: number | null;
  family_discount_percent?: number | null;
  family_discount_reason?: string | null;
  family_book_discount_percent?: number | null;
  family_book_discount_reason?: string | null;
  parent_phone?: string;
  parent_job?: string;
  student_email?: string;
  custom_monthly_price?: number | null;
  sibling_family_id?: string | null;
  sibling_family_name?: string | null;
  subscription_start_month?: number | null; // 1-12
  subscription_start_year?: number | null;
  notes?: string | null;
  is_suspended?: boolean;
  suspension_kind?: "manual" | "financial" | null;
  suspension_threshold?: number | null;
  suspended_until?: Date | null;
  suspension_reason?: string | null;
  group_join_date?: string | null; // YYYY-MM-DD
  center_student_code?: string | null; // موحد لهوية الطالب داخل السنتر — يُستخدم للـ QR فقط
  center_student_id?: mongoose.Types.ObjectId | null; // ref → CenterStudent
  created_at: Date;
}

const StudentSchema = new Schema<IStudent>(
  {
    mutation_version: { type: Number, default: 0 },
    card_qr_version: { type: Number, default: 0 },
    name: { type: String, required: true, trim: true },
    code: { type: String },
    group_id: { type: Schema.Types.ObjectId, ref: "Group", default: null },
    grade_id: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    months: [{ type: Boolean }],
    received_books: [{ type: String }],
    discount_value: { type: Number, default: 0 },
    discount_reason: { type: String },
    apply_discount_to_books: { type: Boolean, default: false },
    book_discount_value: { type: Number, default: null },
    family_discount_percent: { type: Number, default: null },
    family_discount_reason: { type: String, default: null },
    family_book_discount_percent: { type: Number, default: null },
    family_book_discount_reason: { type: String, default: null },
    parent_phone: { type: String },
    parent_job: { type: String },
    student_email: { type: String },
    custom_monthly_price: { type: Number, default: null },
    sibling_family_id: { type: String, default: null, index: true },
    sibling_family_name: { type: String, default: null },
    subscription_start_month: { type: Number, default: null },
    subscription_start_year: { type: Number, default: null },
    notes: { type: String, default: null },
    is_suspended: { type: Boolean, default: false },
    suspension_kind: { type: String, enum: ["manual", "financial", null], default: null },
    suspension_threshold: { type: Number, default: null },
    suspended_until: { type: Date, default: null },
    suspension_reason: { type: String, default: null },
    group_join_date: { type: String, default: null },
    center_student_code: { type: String, default: null },
    center_student_id: { type: Schema.Types.ObjectId, ref: "CenterStudent", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

StudentSchema.virtual("card_qr_token").get(function () { return studentCardToken(this); });
StudentSchema.index({ teacher_id: 1, code: 1 });
StudentSchema.index({ teacher_id: 1, grade_id: 1 });
StudentSchema.index({ teacher_id: 1, group_id: 1 });
StudentSchema.index({ teacher_id: 1, name: 1 });
StudentSchema.index({ teacher_id: 1, parent_phone: 1 }); // lookupFamily query
// index للبحث النصي — بيخلي $regex على name و code أسرع بكتير
StudentSchema.index({ teacher_id: 1, name: "text", code: "text" });

// ── Performance indexes (P3) ──────────────────────────────────────────────────
// Compound indexes for the most frequent query patterns in controllers & cron.
StudentSchema.index({ teacher_id: 1, created_at: -1 }); // default student list sort
StudentSchema.index({ teacher_id: 1, is_suspended: 1 }); // suspension filter in cron
StudentSchema.index({ group_id: 1, is_suspended: 1 });   // cron absent-marking filter
StudentSchema.index({ center_student_code: 1 }, { sparse: true }); // center QR lookup
StudentSchema.index({ teacher_id: 1, center_student_code: 1 }); // scan: find record by teacher + center code
StudentSchema.index({ center_student_id: 1 }, { sparse: true }); // lookup all records for a CenterStudent

export const Student = mongoose.model<IStudent>("Student", StudentSchema);
