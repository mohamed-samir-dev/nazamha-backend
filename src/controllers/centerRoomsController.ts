import { Response } from "express";
import { CenterRoom } from "../models/CenterRoom";
import { AuditLog } from "../models/AuditLog";
import { AuthRequest } from "../middleware/auth";
import mongoose from "mongoose";

// ── List rooms ────────────────────────────────────────────────────────────────
export const getCenterRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const rooms = await CenterRoom.find({ center_id: centerId, deleted_at: null })
    .sort({ created_at: -1 })
    .lean();
  res.json(rooms.map((r: any) => ({ ...r, id: r._id.toString() })));
};

// ── Create room ───────────────────────────────────────────────────────────────
export const createCenterRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { name, capacity } = req.body;

  const trimmedName = (name || "").trim();
  if (!trimmedName) { res.status(400).json({ message: "اسم القاعة مطلوب" }); return; }
  if (trimmedName.length > 100) { res.status(400).json({ message: "اسم القاعة طويل جداً" }); return; }

  const cap = Number(capacity);
  if (!Number.isInteger(cap) || cap < 1) {
    res.status(400).json({ message: "السعة يجب أن تكون رقماً صحيحاً موجباً" }); return;
  }
  if (cap > 1000) { res.status(400).json({ message: "السعة لا يمكن أن تتجاوز 1000 طالب" }); return; }

  const room = await CenterRoom.create({
    name: trimmedName,
    capacity: cap,
    center_id: new mongoose.Types.ObjectId(centerId),
  });

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Center Owner",
    action: "center.room.create",
    resource_type: "CenterRoom",
    resource_id: (room._id as any).toString(),
    new_data: { name: trimmedName, capacity: cap },
    ip_address: req.ip,
  }).catch(() => {});

  res.status(201).json({ ...(room as any).toObject(), id: (room._id as any).toString() });
};

// ── Update room ───────────────────────────────────────────────────────────────
export const updateCenterRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const { name, capacity } = req.body;
  const updates: Record<string, unknown> = {};

  if (name !== undefined) {
    const trimmed = (name || "").trim();
    if (!trimmed) { res.status(400).json({ message: "اسم القاعة مطلوب" }); return; }
    if (trimmed.length > 100) { res.status(400).json({ message: "اسم القاعة طويل جداً" }); return; }
    updates.name = trimmed;
  }
  if (capacity !== undefined) {
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      res.status(400).json({ message: "السعة يجب أن تكون رقماً صحيحاً موجباً" }); return;
    }
    if (cap > 1000) { res.status(400).json({ message: "السعة لا يمكن أن تتجاوز 1000 طالب" }); return; }
    updates.capacity = cap;
  }

  const room = await CenterRoom.findOneAndUpdate(
    { _id: req.params.roomId, center_id: centerId, deleted_at: null },
    updates,
    { new: true, runValidators: true }
  );
  if (!room) { res.status(404).json({ message: "القاعة غير موجودة" }); return; }

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Center Owner",
    action: "center.room.update",
    resource_type: "CenterRoom",
    resource_id: req.params.roomId,
    new_data: updates,
    ip_address: req.ip,
  }).catch(() => {});

  res.json({ ...(room as any).toObject(), id: (room._id as any).toString() });
};

// ── Toggle room status ────────────────────────────────────────────────────────
export const toggleCenterRoomStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const room = await CenterRoom.findOne({ _id: req.params.roomId, center_id: centerId, deleted_at: null });
  if (!room) { res.status(404).json({ message: "القاعة غير موجودة" }); return; }

  room.is_active = !room.is_active;
  await room.save({ validateBeforeSave: false });

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Center Owner",
    action: room.is_active ? "center.room.activate" : "center.room.deactivate",
    resource_type: "CenterRoom",
    resource_id: req.params.roomId,
    new_data: { name: room.name, is_active: room.is_active },
    ip_address: req.ip,
  }).catch(() => {});

  res.json({ is_active: room.is_active });
};

// ── Delete (soft) room ────────────────────────────────────────────────────────
export const deleteCenterRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;
  const room = await CenterRoom.findOneAndUpdate(
    { _id: req.params.roomId, center_id: centerId, deleted_at: null },
    { deleted_at: new Date(), is_active: false },
    { new: true }
  );
  if (!room) { res.status(404).json({ message: "القاعة غير موجودة" }); return; }

  await AuditLog.create({
    admin_id: req.user!.id,
    admin_name: "Center Owner",
    action: "center.room.delete",
    resource_type: "CenterRoom",
    resource_id: req.params.roomId,
    new_data: { name: room.name },
    ip_address: req.ip,
  }).catch(() => {});

  res.json({ message: "تم حذف القاعة بنجاح" });
};

// ── Center audit log ──────────────────────────────────────────────────────────
export const getCenterAuditLog = async (req: AuthRequest, res: Response): Promise<void> => {
  const centerId = req.user!.center_id!;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  // Only show logs where admin_id matches the center's own ID (center owner actions)
  const [logs, total] = await Promise.all([
    AuditLog.find({ admin_id: centerId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments({ admin_id: centerId }),
  ]);

  res.json({
    data: logs.map((l: any) => ({
      id: l._id.toString(),
      action: l.action,
      resource_type: l.resource_type,
      resource_id: l.resource_id,
      old_data: l.old_data,
      new_data: l.new_data,
      created_at: l.created_at,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
};
