import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/systemSettingsController";
import { protect, adminOnly } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// GET is public — settings like site name and logo are needed server-side (metadata)
router.get("/", asyncHandler(getSettings));
router.patch("/", protect, adminOnly, asyncHandler(updateSettings));

export default router;
