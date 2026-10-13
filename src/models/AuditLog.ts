import mongoose, { Schema, Document } from "mongoose";

export type AuditAction =
  | "request.write"
  | "student.create" | "student.update" | "student.delete"
  | "bill.create" | "bill.update" | "bill.delete"
  | "book.sell" | "book.create" | "book.update"
  | "attendance.mark"
  | "discount.apply" | "discount.remove"
  | "group.create" | "group.update" | "group.delete"
  | "payment.register"
  | "whatsapp.send"
  | "teacher.create" | "teacher.update" | "teacher.delete" | "teacher.activate" | "teacher.deactivate" | "teacher.price_update"
  | "admin.create" | "admin.update" | "admin.deactivate" | "admin.login" | "admin.logout" | "admin.activate"
  | "center.create" | "center.update" | "center.activate" | "center.deactivate" | "center.delete"
  | "center.teacher.add" | "center.teacher.remove"
  | "center.staff.create" | "center.staff.update" | "center.staff.deactivate" | "center.staff.transfer"
  | "center.room.create" | "center.room.update" | "center.room.delete" | "center.room.activate" | "center.room.deactivate"
  | "settings.update";

export interface IAuditLog extends Document {
  actor_id?: mongoose.Types.ObjectId;
  actor_type?: string;
  teacher_id?: mongoose.Types.ObjectId;
  outcome?: "success" | "failure";
  status_code?: number;
  admin_id: mongoose.Types.ObjectId;
  admin_name: string;
  action: AuditAction;
  resource_type: string;
  resource_id?: string;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  ip_address?: string;
  created_at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    admin_id: { type: Schema.Types.ObjectId, ref: "Admin" },
    admin_name: { type: String, default: "" },
    actor_id: { type: Schema.Types.ObjectId },
    actor_type: { type: String, enum: ["teacher", "admin", "center", "staff"] },
    teacher_id: { type: Schema.Types.ObjectId, ref: "Teacher" },
    outcome: { type: String, enum: ["success", "failure"] },
    status_code: { type: Number },
    action: { type: String, required: true },
    resource_type: { type: String, required: true },
    resource_id: { type: String },
    old_data: { type: Schema.Types.Mixed },
    new_data: { type: Schema.Types.Mixed },
    ip_address: { type: String },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

AuditLogSchema.index({ admin_id: 1, created_at: -1 });
AuditLogSchema.index({ teacher_id: 1, created_at: -1 });
AuditLogSchema.index({ created_at: -1 });
// TTL: auto-delete audit logs older than 2 years (63072000 seconds)
AuditLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 63072000 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
