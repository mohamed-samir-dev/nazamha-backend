import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getDashboard, getDashboardPayments } from "../controllers/dashboardController";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getDashboard));
router.get("/payments", asyncHandler(getDashboardPayments));

export default router;
