import { Router } from "express";
import { protect, adminOnly, superAdminOnly } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getMe, changeMyPassword, updateMe, getAllTeachers, getTeacherCounts, getAdminStats, createTeacher, getTeacherById, toggleTeacherVisibility, updateTeacher, deleteTeacher, updateTeacherBanner } from "../controllers/teachersController";

const router = Router();
router.use(protect);

router.get("/me", asyncHandler(getMe));
router.patch("/me", asyncHandler(updateMe));
router.patch("/me/password", asyncHandler(changeMyPassword));
router.get("/", adminOnly, asyncHandler(getAllTeachers));
router.get("/admin-stats", adminOnly, asyncHandler(getAdminStats));
router.get("/counts", adminOnly, asyncHandler(getTeacherCounts));
router.post("/", superAdminOnly, asyncHandler(createTeacher));
router.get("/:id", adminOnly, asyncHandler(getTeacherById));
router.patch("/:id/banner", adminOnly, asyncHandler(updateTeacherBanner));
router.patch("/:id/visibility", superAdminOnly, asyncHandler(toggleTeacherVisibility));
router.patch("/:id", adminOnly, asyncHandler(updateTeacher));
router.delete("/:id", superAdminOnly, asyncHandler(deleteTeacher));

export default router;
