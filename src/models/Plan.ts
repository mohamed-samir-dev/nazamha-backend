import mongoose, { Schema, Document } from "mongoose";

export interface IPlan extends Document {
  name: string;
  price_egp: number;
  max_students: number;
  features: string[];
  created_at: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: { type: String, required: true, trim: true },
    price_egp: { type: Number, required: true },
    max_students: { type: Number, required: true },
    features: [{ type: String }],
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

export const Plan = mongoose.model<IPlan>("Plan", PlanSchema);
