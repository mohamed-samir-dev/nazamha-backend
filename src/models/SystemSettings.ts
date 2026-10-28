import mongoose, { Schema, Document } from "mongoose";

export interface ISystemSettings extends Document {
  site_name: string;
  sidebar_name?: string;
  site_logo: string;
  site_favicon?: string;
  hide_sidebar_name?: boolean;
  maintenance_mode: boolean;
  maintenance_message: string;
  welcome_message: string;
  welcome_message_enabled: boolean;
  qr_header_type: "image" | "teacher";
  payment_grace_period_days?: number;
}

const SystemSettingsSchema = new Schema<ISystemSettings>(
  {
    site_name: { type: String, default: "إدارة السناتر والمعلمين" },
    sidebar_name: { type: String },
    site_logo: { type: String, default: "" },
    site_favicon: { type: String },
    hide_sidebar_name: { type: Boolean, default: false },
    maintenance_mode: { type: Boolean, default: false },
    maintenance_message: { type: String, default: "المنصة تحت الصيانة، سنعود قريباً." },
    welcome_message: { type: String, default: "" },
    welcome_message_enabled: { type: Boolean, default: false },
    qr_header_type: { type: String, enum: ["image", "teacher"], default: "teacher" },
    payment_grace_period_days: { type: Number, default: 10, min: 0, max: 31 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; delete ret.__v; return ret; },
    },
  }
);

export const SystemSettings = mongoose.model<ISystemSettings>("SystemSettings", SystemSettingsSchema);
