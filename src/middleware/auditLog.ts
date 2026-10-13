import { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";
import { AuditLog, AuditAction } from "../models/AuditLog";

export function auditLog(action: AuditAction, resourceType: string) {
  return (_req: AuthRequest, res: Response, next: NextFunction): void => {
    res.locals.auditAction = action;
    res.locals.auditResource = resourceType;
    next();
  };
}

/** Record outcome after response completion, without storing sensitive bodies. */
export function auditRequest(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) { next(); return; }
  res.once("finish", () => {
    const user = req.user;
    if (!user) return;
    const actorType = user.actor_type || user.user_type;
    void AuditLog.create({
      actor_id: user.actor_id || user.id,
      actor_type: actorType,
      ...(actorType === "admin" ? { admin_id: user.actor_id || user.id } : {}),
      ...(user.effective_teacher_id || user.user_type === "teacher" ? { teacher_id: user.effective_teacher_id || user.id } : {}),
      action: res.locals.auditAction || "request.write",
      resource_type: res.locals.auditResource || req.baseUrl || req.path.split("/")[2] || "api",
      resource_id: req.params?.id,
      outcome: res.statusCode < 400 ? "success" : "failure",
      status_code: res.statusCode,
      ip_address: req.ip,
    }).catch(error => console.error("[audit] write failed", error.message));
  });
  next();
}
