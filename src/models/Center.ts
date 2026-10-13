import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface ICenter extends Document {
  name: string;
  email: string;
  password: string;
  session_version?: number;
  password_changed_at?: Date;
  phone?: string;
  address?: string;
  manager_name?: string;
  whatsapp?: string;
  governorate?: string;
  is_active: boolean;
  failed_login_attempts: number;
  last_login_at?: Date;
  last_login_ip?: string;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const CenterSchema = new Schema<ICenter>(
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
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    manager_name: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    governorate: { type: String, trim: true },
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

CenterSchema.index({ is_active: 1 });
CenterSchema.index({ deleted_at: 1 });

CenterSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.session_version = (this.session_version || 0) + 1;
  if (!this.isNew) this.password_changed_at = new Date();
  next();
});

CenterSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const Center = mongoose.model<ICenter>("Center", CenterSchema);
