import mongoose, { Schema, Document } from "mongoose";

export interface ISubTeacher extends Document {
  name: string;
  phone?: string;
  subject?: string;
  center_id: mongoose.Types.ObjectId;
  grade_ids?: mongoose.Types.ObjectId[];
  created_at: Date;
}

const SubTeacherSchema = new Schema<ISubTeacher>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String },
    subject: { type: String, trim: true },
    center_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    grade_ids: [{ type: Schema.Types.ObjectId, ref: "Grade" }],
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

SubTeacherSchema.index({ center_id: 1 });

export const SubTeacher = mongoose.model<ISubTeacher>("SubTeacher", SubTeacherSchema);
