import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getStudentSubscriptions,
  getBatchSubscriptions,
  getAllTeacherSubscriptions,
  updateSubscription,
  bulkUpdateSubscriptions,
  regenerateSubscriptions,
  fixSubscriptionAmounts,
  autoSuspendStudents,
  syncAllStudents,
  fixRolloverData,
  getSubscriptionsSummary,
} from "../controllers/subscriptionsController";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getAllTeacherSubscriptions));
router.get("/summary", asyncHandler(getSubscriptionsSummary));
router.get("/batch", asyncHandler(getBatchSubscriptions));
router.get("/student/:studentId", asyncHandler(getStudentSubscriptions));
router.patch("/:id", asyncHandler(updateSubscription));
router.post("/student/:studentId/bulk-update", asyncHandler(bulkUpdateSubscriptions));
router.post("/student/:studentId/regenerate", asyncHandler(regenerateSubscriptions));
router.post("/fix-amounts", asyncHandler(fixSubscriptionAmounts));
router.post("/auto-suspend", asyncHandler(autoSuspendStudents));
router.post("/sync-all", asyncHandler(syncAllStudents));
router.post("/fix-rollover", asyncHandler(fixRolloverData));

export default router;
