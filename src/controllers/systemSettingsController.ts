import { Response } from "express";
import { SystemSettings } from "../models/SystemSettings";
import { AuthRequest } from "../middleware/auth";
import { AuditLog } from "../models/AuditLog";

export const getSettings = async (_req: AuthRequest, res: Response): Promise<void> => {
  let settings = await SystemSettings.findOne();
  if (!settings) settings = await SystemSettings.create({});
  res.json(settings);
};

export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  let settings = await SystemSettings.findOne();
  if (!settings) {
    settings = await SystemSettings.create(req.body);
  } else {
    settings = await SystemSettings.findByIdAndUpdate(settings._id, req.body, { new: true, runValidators: true });
  }
  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Admin",
    action: "settings.update",
    resource_type: "SystemSettings",
    new_data: req.body,
    ip_address: req.ip,
  }).catch(() => {});
  res.json(settings);
};
