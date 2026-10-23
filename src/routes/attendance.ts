import { Router } from "express";
import { getAttendance, validateCrossGroupScan, upsertAttendance, bulkUpsertAttendance, deleteAttendance, autoMarkAbsent, batchAutoMarkAbsent, getStudentAttendanceSummary, getAllTimeStats, getLastSessionAbsentees } from "../controllers/attendanceController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import {listLessons,createLesson,lessonDetails,changeLessonState,markLessonAttendance,lessonRecordHistory,rotateAttendanceCard,attendanceDebt,lessonsReport} from "../controllers/attendanceLessonsController";

const router = Router();
import { attendanceContext } from "../controllers/attendanceContextController";
router.use(protect);
router.get("/lessons", asyncHandler(listLessons));
router.get("/lessons-report", asyncHandler(lessonsReport));
router.post("/lessons", asyncHandler(createLesson));
router.get("/lessons/:id", asyncHandler(lessonDetails));
router.patch("/lessons/:id/state", asyncHandler(changeLessonState));
router.post("/lessons/:id/mark", asyncHandler(markLessonAttendance));
router.get("/history/:recordId", asyncHandler(lessonRecordHistory));
router.post("/cards/:studentId/replace", asyncHandler(rotateAttendanceCard));
router.get("/debt/:studentId", asyncHandler(attendanceDebt));
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
