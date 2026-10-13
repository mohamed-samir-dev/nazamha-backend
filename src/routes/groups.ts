import { Router } from "express";
import { getGroups, getGroupsBySubTeacher, addGroup, addGroupsBulk, updateGroup, updateGroupsByGrade, deleteGroup, deleteGroupsBulk, toggleCancelSession, exportCalendar, getCalendarSyncUrl } from "../controllers/groupsController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/calendar.ics", asyncHandler(exportCalendar));
router.get("/calendar-sync-url", asyncHandler(getCalendarSyncUrl));
router.get("/", asyncHandler(getGroups));
router.post("/", asyncHandler(addGroup));
router.post("/bulk", asyncHandler(addGroupsBulk));
router.delete("/bulk", asyncHandler(deleteGroupsBulk));
router.get("/sub-teacher/:subTeacherId", asyncHandler(getGroupsBySubTeacher));
router.patch("/by-grade/:gradeId", asyncHandler(updateGroupsByGrade));
router.patch("/:id", asyncHandler(updateGroup));
router.post("/:id/cancel-session", asyncHandler(toggleCancelSession));
router.delete("/:id", asyncHandler(deleteGroup));

export default router;
