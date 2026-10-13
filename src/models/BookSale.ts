import mongoose, { Schema, Document } from "mongoose";

export type BookSaleStatus = "active" | "cancelled";

export interface IBookSale extends Document {
  teacher_id: mongoose.Types.ObjectId;
  book_id: mongoose.Types.ObjectId;
  student_id: mongoose.Types.ObjectId;
  price: number;
  discount: number;
  discount_reason?: string | null;
  final_price: number;
  is_exempt: boolean;
  subscription_id?: mongoose.Types.ObjectId | null;
  month: number;
  year: number;
  status: BookSaleStatus;
  cancelled_at?: Date | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  sold_by?: string | null;
  created_at: Date;
}

const BookSaleSchema = new Schema<IBookSale>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    book_id: { type: Schema.Types.ObjectId, ref: "Book", required: true, index: true },
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    discount_reason: { type: String, default: null },
    final_price: { type: Number, required: true },
    is_exempt: { type: Boolean, default: false },
    subscription_id: { type: Schema.Types.ObjectId, ref: "MonthlySubscription", default: null },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    status: { type: String, enum: ["active", "cancelled"], default: "active" },
    cancelled_at: { type: Date, default: null },
    cancelled_by: { type: String, default: null },
    cancel_reason: { type: String, default: null },
    sold_by: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

BookSaleSchema.index({ teacher_id: 1, book_id: 1, student_id: 1 });
BookSaleSchema.index({ teacher_id: 1, month: 1, year: 1 });
// NEW: year-scoped financial queries
BookSaleSchema.index({ teacher_id: 1, year: 1, status: 1 });
// financial report query: teacher + status
BookSaleSchema.index({ teacher_id: 1, status: 1 });
// financial report date-range query: teacher + status + created_at
BookSaleSchema.index({ teacher_id: 1, status: 1, created_at: 1 });

export const BookSale = mongoose.model<IBookSale>("BookSale", BookSaleSchema);
