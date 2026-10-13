import mongoose, { Schema, Document } from "mongoose";

export interface IBook extends Document {
  teacher_id: mongoose.Types.ObjectId;
  name: string;
  description?: string | null;
  cover_image?: string | null;
  grade_id?: mongoose.Types.ObjectId | null;
  group_id?: mongoose.Types.ObjectId | null;
  price: number;
  status: "available" | "unavailable";
  sort_order: number;
  code?: string | null;
  academic_year?: string | null;
  created_at: Date;
}

const BookSchema = new Schema<IBook>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    cover_image: { type: String, default: null },
    grade_id: { type: Schema.Types.ObjectId, ref: "Grade", default: null },
    group_id: { type: Schema.Types.ObjectId, ref: "Group", default: null },
    price: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["available", "unavailable"], default: "available" },
    sort_order: { type: Number, default: 0 },
    code: { type: String, default: null, trim: true, sparse: true },
    academic_year: { type: String, default: null, trim: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

export const Book = mongoose.model<IBook>("Book", BookSchema);
