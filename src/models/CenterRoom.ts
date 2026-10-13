import mongoose, { Schema, Document } from "mongoose";

export interface ICenterRoom extends Document {
  name: string;
  capacity: number;
  center_id: mongoose.Types.ObjectId;
  is_active: boolean;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const CenterRoomSchema = new Schema<ICenterRoom>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    capacity: { type: Number, required: true, min: 1, max: 1000 },
    center_id: { type: Schema.Types.ObjectId, ref: "Center", required: true },
    is_active: { type: Boolean, default: true },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

CenterRoomSchema.index({ center_id: 1, deleted_at: 1 });

export const CenterRoom = mongoose.model<ICenterRoom>("CenterRoom", CenterRoomSchema);
