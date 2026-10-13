import mongoose, { Schema, Document } from "mongoose";

export interface IGrade extends Document {
  name: string;
  start_code?: number;
  prefix?: string;
  monthly_price?: number | null;
  teacher_id: mongoose.Types.ObjectId;
  created_at: Date;
}

const GradeSchema = new Schema<IGrade>(
  {
    name: { type: String, required: true, trim: true },
    start_code: { type: Number, default: 0 },
    prefix: { type: String, default: "" },
    monthly_price: { type: Number, default: null },
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

GradeSchema.index({ teacher_id: 1 });

export const Grade = mongoose.model<IGrade>("Grade", GradeSchema);
