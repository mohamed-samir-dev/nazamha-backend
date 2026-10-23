import { Router } from "express";
import { getAttendance, validateCrossGroupScan, upsertAttendance, bulkUpsertAttendance, deleteAttendance, autoMarkAbsent, batchAutoMarkAbsent, getStudentAttendanceSummary, getAllTimeStats, getLastSessionAbsentees } from "../controllers/attendanceController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
import { attendanceContext } from "../controllers/attendanceContextController";
router.use(protect);
router.get("/context", asyncHandler(attendanceContext));

router.get("/", asyncHandler(getAttendance));
router.get("/all-time-stats", asyncHandler(getAllTimeStats));
router.get("/last-session-absentees", asyncHandler(getLastSessionAbsentees));
router.get("/summary/:studentId", asyncHandler(getStudentAttendanceSummary));
router.post("/validate-cross-group", asyncHandler(validateCrossGroupScan));
router.post("/", asyncHandler(upsertAttendance));
router.post("/bulk", asyncHandler(bulkUpsertAttendance));
router.post("/auto-absent", asyncHandler(autoMarkAbsent));
router.post("/auto-absent/batch", asyncHandler(batchAutoMarkAbsent));
router.delete("/:id", asyncHandler(deleteAttendance));

export default router;
