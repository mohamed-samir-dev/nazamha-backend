import mongoose, { Schema, Document } from "mongoose";

export interface IStudentShareToken extends Document {
  student_id: mongoose.Types.ObjectId;
  center_student_id?: mongoose.Types.ObjectId;
  teacher_id: mongoose.Types.ObjectId;
  token_hash: string;    // SHA-256 of raw token — never store the raw token
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
}

const StudentShareTokenSchema = new Schema<IStudentShareToken>(
  {
    center_student_id: { type: Schema.Types.ObjectId, ref: "CenterStudent", default: null },
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    token_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

StudentShareTokenSchema.index({ token_hash: 1 }, { unique: true });
StudentShareTokenSchema.index({ student_id: 1 });
StudentShareTokenSchema.index({ teacher_id: 1 });
// MongoDB auto-deletes documents when expires_at is reached
StudentShareTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const StudentShareToken = mongoose.model<IStudentShareToken>(
  "StudentShareToken",
  StudentShareTokenSchema
);
