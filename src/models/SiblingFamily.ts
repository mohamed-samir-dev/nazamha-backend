import mongoose, { Schema, Document } from "mongoose";

export interface ISiblingFamily extends Document {
  teacher_id: mongoose.Types.ObjectId;
  family_name: string;
  parent_phone?: string | null;
  created_at: Date;
}

const SiblingFamilySchema = new Schema<ISiblingFamily>(
  {
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    family_name: { type: String, required: true, trim: true },
    parent_phone: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

export const SiblingFamily = mongoose.model<ISiblingFamily>("SiblingFamily", SiblingFamilySchema);
