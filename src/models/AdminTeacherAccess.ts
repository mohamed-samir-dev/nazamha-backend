import mongoose, { Schema, Document } from "mongoose";

export interface IAdminTeacherAccess extends Document {
  admin_id: mongoose.Types.ObjectId;
  teacher_id: mongoose.Types.ObjectId;
  created_at: Date;
}

const AdminTeacherAccessSchema = new Schema<IAdminTeacherAccess>(
  {
    admin_id: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

AdminTeacherAccessSchema.index({ admin_id: 1 });
AdminTeacherAccessSchema.index({ admin_id: 1, teacher_id: 1 }, { unique: true });

export const AdminTeacherAccess = mongoose.model<IAdminTeacherAccess>(
  "AdminTeacherAccess",
  AdminTeacherAccessSchema
);
