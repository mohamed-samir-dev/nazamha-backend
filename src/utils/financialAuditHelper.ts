import { Types } from "mongoose";
import { AuditLog, AuditAction } from "../models/AuditLog";
import { AuthRequest } from "../middleware/auth";

export interface LogFinancialActionParams {
  req: AuthRequest;
  teacherId: string | Types.ObjectId;
  action: AuditAction;
  resourceType: "employee" | "payroll" | "expense" | "recurring";
  resourceId?: string;
  oldData?: any;
  newData?: any;
}

export async function logFinancialAction(params: LogFinancialActionParams): Promise<void> {
  try {
    const { req, teacherId, action, resourceType, resourceId, oldData, newData } = params;
    const actorId = req.user?.actor_id || req.user?.id;
    const actorType = req.user?.actor_type || req.user?.user_type || "teacher";

    await AuditLog.create({
      actor_id: actorId ? new Types.ObjectId(actorId) : undefined,
      actor_type: actorType,
      teacher_id: new Types.ObjectId(teacherId),
      admin_id: req.user?.is_admin ? new Types.ObjectId(req.user.id) : undefined,
      admin_name: (req.user as any)?.name || "",
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_data: oldData || undefined,
      new_data: newData || undefined,
      ip_address: req.ip || "",
      outcome: "success",
    });
  } catch (error) {
    // Non-fatal: do not block the financial operation if audit logging encounters an issue
    console.error("[financialAuditHelper] failed to record audit log:", error);
  }
}
