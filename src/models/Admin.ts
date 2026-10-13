import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export type FinancialPermission =
  | "financial.viewRevenue"
  | "financial.viewInvoices"
  | "financial.editInvoices"
  | "financial.applyDiscount"
  | "financial.applyExemption"
  | "financial.editBookPrice"
  | "centers.view";

export const ALL_FINANCIAL_PERMISSIONS: FinancialPermission[] = [
  "financial.viewRevenue",
  "financial.viewInvoices",
  "financial.editInvoices",
  "financial.applyDiscount",
  "financial.applyExemption",
  "financial.editBookPrice",
  "centers.view",
];

export interface IAdmin extends Document {
  name: string;
  email: string;
  password: string;
  session_version?: number;
  password_changed_at?: Date;
  is_super_admin: boolean;
  is_active: boolean;
  financial_permissions: FinancialPermission[];
  failed_login_attempts: number;
  last_login_at?: Date;
  last_login_ip?: string;
  deleted_at?: Date | null;
  comparePassword(candidate: string): Promise<boolean>;
}

const AdminSchema = new Schema<IAdmin>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_changed_at: { type: Date },
    session_version: { type: Number, default: 0 },
    password: { type: String, required: true, minlength: 6, select: false },
    is_super_admin: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
    financial_permissions: {
      type: [String],
      enum: ALL_FINANCIAL_PERMISSIONS,
      default: [],
    },
    failed_login_attempts: { type: Number, default: 0 },
    last_login_at: { type: Date },
    last_login_ip: { type: String },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

AdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.session_version = (this.session_version || 0) + 1;
  if (!this.isNew) this.password_changed_at = new Date();
  next();
});

AdminSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

// Performance indexes
AdminSchema.index({ is_active: 1 });
AdminSchema.index({ deleted_at: 1 });
AdminSchema.index({ is_super_admin: 1 });
AdminSchema.index({ deleted_at: 1, is_active: 1 });

export const Admin = mongoose.model<IAdmin>("Admin", AdminSchema);
