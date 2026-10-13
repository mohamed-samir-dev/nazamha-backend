import { Router } from "express";
import { protect, superAdminOnly } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getAdmins, getAdminById, createAdmin, updateAdmin, deactivateAdmin, getAuditLogs } from "../controllers/adminsController";

const router = Router();
router.use(protect, superAdminOnly);

router.get("/", asyncHandler(getAdmins));
router.post("/", asyncHandler(createAdmin));
router.get("/audit-logs", asyncHandler(getAuditLogs));
router.get("/:id", asyncHandler(getAdminById));
router.patch("/:id", asyncHandler(updateAdmin));
router.delete("/:id", asyncHandler(deactivateAdmin));

export default router;
