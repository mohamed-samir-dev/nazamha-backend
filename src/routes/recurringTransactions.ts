import { Router } from "express";
import {
  getRecurringTransactions,
  getRecurringById,
  addRecurringTransaction,
  updateRecurringTransaction,
  pauseRecurringTransaction,
  resumeRecurringTransaction,
  stopRecurringTransaction,
  syncRecurring,
  getRecurringOccurrences,
} from "../controllers/recurringTransactionsController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);
router.use((req: any, res: any, next: any) => {
  if (req.user?.user_type === "staff" || req.user?.effective_teacher_id) {
    res.status(403).json({ message: "غير مصرح للمساعدين بالوصول إلى المعاملات المتكررة" });
    return;
  }
  next();
});

router.get("/", asyncHandler(getRecurringTransactions));
router.post("/sync", asyncHandler(syncRecurring));
router.get("/:id", asyncHandler(getRecurringById));
router.get("/:id/occurrences", asyncHandler(getRecurringOccurrences));
router.post("/", asyncHandler(addRecurringTransaction));
router.patch("/:id/pause", asyncHandler(pauseRecurringTransaction));
router.patch("/:id/resume", asyncHandler(resumeRecurringTransaction));
router.patch("/:id/stop", asyncHandler(stopRecurringTransaction));
router.patch("/:id", asyncHandler(updateRecurringTransaction));
router.put("/:id", asyncHandler(updateRecurringTransaction));

export default router;
