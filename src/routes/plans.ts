import { Router } from "express";
import { getPlans, addPlan, updatePlan, deletePlan } from "../controllers/plansController";
import { protect, adminOnly } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

router.get("/", protect, asyncHandler(getPlans));
router.post("/", protect, adminOnly, asyncHandler(addPlan));
router.patch("/:id", protect, adminOnly, asyncHandler(updatePlan));
router.delete("/:id", protect, adminOnly, asyncHandler(deletePlan));

export default router;
