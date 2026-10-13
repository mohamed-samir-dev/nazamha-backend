import { Response } from "express";
import { Plan } from "../models/Plan";
import { AuthRequest } from "../middleware/auth";

export const getPlans = async (_req: AuthRequest, res: Response): Promise<void> => {
  const plans = await Plan.find().sort({ created_at: 1 });
  res.json(plans);
};

export const addPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  const plan = await Plan.create(req.body);
  res.status(201).json(plan);
};

export const updatePlan = async (req: AuthRequest, res: Response): Promise<void> => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!plan) { res.status(404).json({ message: "الخطة غير موجودة" }); return; }
  res.json(plan);
};

export const deletePlan = async (req: AuthRequest, res: Response): Promise<void> => {
  await Plan.findByIdAndDelete(req.params.id);
  res.json({ message: "تم الحذف بنجاح" });
};
