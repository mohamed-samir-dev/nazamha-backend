import { Router } from "express";
import { getFinancialOverview, getTransactionHistory } from "../controllers/financialOverviewController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);
router.use((req: any, res: any, next: any) => {
  if (req.user?.user_type === "staff" || req.user?.effective_teacher_id) {
    res.status(403).json({ message: "غير مصرح للمساعدين بالوصول إلى النظرة العامة المالية" });
    return;
  }
  next();
});

router.get("/", asyncHandler(getFinancialOverview));
router.get("/history", asyncHandler(getTransactionHistory));

export default router;
