import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export type StaffPermission =
  | "attendance"
  | "students"
  | "groups"
  | "teachers"
  | "reports"
  | "payments"
  | "exams";

export const ALL_STAFF_PERMISSIONS: StaffPermission[] = [
  "attendance",
  "students",
  "groups",
  "teachers",
  "reports",
  "payments",
  "exams",
];

export interface ICenterStaff extends Document {
  name: string;
  email: string;
  password: string;
  session_version?: number;
  password_changed_at?: Date;
  center_id: mongoose.Types.ObjectId;
  teacher_id?: mongoose.Types.ObjectId | null; // if set → this staff is an Assistant for that specific teacher
  permissions: StaffPermission[];
  is_active: boolean;
  failed_login_attempts: number;
  last_login_at?: Date;
  last_login_ip?: string;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const CenterStaffSchema = new Schema<ICenterStaff>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password_changed_at: { type: Date },
    session_version: { type: Number, default: 0 },
    password: { type: String, required: true, minlength: 6, select: false },
    center_id: { type: Schema.Types.ObjectId, ref: "Center", required: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher", default: null },
    permissions: {
      type: [String],
      enum: ALL_STAFF_PERMISSIONS,
      default: [],
    },
    is_active: { type: Boolean, default: true },
    failed_login_attempts: { type: Number, default: 0 },
    last_login_at: { type: Date },
    last_login_ip: { type: String },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret["password"];
        delete ret["__v"];
        return ret;
      },
    },
  }
);

CenterStaffSchema.index({ center_id: 1 });
CenterStaffSchema.index({ center_id: 1, is_active: 1 });
CenterStaffSchema.index({ teacher_id: 1 });
CenterStaffSchema.index({ deleted_at: 1 });

CenterStaffSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.session_version = (this.session_version || 0) + 1;
  if (!this.isNew) this.password_changed_at = new Date();
  next();
});

CenterStaffSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const CenterStaff = mongoose.model<ICenterStaff>("CenterStaff", CenterStaffSchema);
