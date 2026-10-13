import { Router } from "express";
import {
  getCenters, getCenterById, createCenter, updateCenter,
  toggleCenterStatus, resetCenterPassword, deleteCenter, getCenterStats,
  getCenterTeachers, createCenterTeacher, updateCenterTeacher,
  resetCenterTeacherPassword, removeCenterTeacher, getCenterTeacherStats,
  getCenterStaff, createCenterStaff, updateCenterStaff,
  resetStaffPassword, deleteCenterStaff, transferAssistant,
  toggleCenterStaffStatus,
  getCenterDashboard, updateCenterInfo, getCenterFinancialReport,
} from "../controllers/centersController";
import {
  getCenterRooms, createCenterRoom, updateCenterRoom,
  toggleCenterRoomStatus, deleteCenterRoom, getCenterAuditLog,
} from "../controllers/centerRoomsController";
import { protect, adminOnly, superAdminOnly, centerOnly, centerOrStaff, requireStaffPermission, requireCenterPermission } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

// ── Admin: manage centers ─────────────────────────────────────────────────────
router.get("/", adminOnly, requireCenterPermission, asyncHandler(getCenters));
router.post("/", superAdminOnly, asyncHandler(createCenter));
router.get("/:id/stats", adminOnly, requireCenterPermission, asyncHandler(getCenterStats));
router.get("/:id", adminOnly, requireCenterPermission, asyncHandler(getCenterById));
router.patch("/:id/status", superAdminOnly, asyncHandler(toggleCenterStatus));
router.patch("/:id/reset-password", superAdminOnly, asyncHandler(resetCenterPassword));
router.patch("/:id", superAdminOnly, asyncHandler(updateCenter));
router.delete("/:id", superAdminOnly, asyncHandler(deleteCenter));

// ── Center: own dashboard + info ─────────────────────────────────────────────
router.get("/me/dashboard", centerOrStaff, requireStaffPermission("reports"), asyncHandler(getCenterDashboard));
router.patch("/me/info", centerOnly, asyncHandler(updateCenterInfo));

// ── Center: manage own teachers ───────────────────────────────────────────────
router.get("/me/teachers", centerOrStaff, requireStaffPermission("teachers"), asyncHandler(getCenterTeachers));
router.post("/me/teachers", centerOnly, asyncHandler(createCenterTeacher));
router.get("/me/teachers/:teacherId/stats", centerOnly, asyncHandler(getCenterTeacherStats));
router.patch("/me/teachers/:teacherId/reset-password", centerOnly, asyncHandler(resetCenterTeacherPassword));
router.patch("/me/teachers/:teacherId", centerOnly, asyncHandler(updateCenterTeacher));
router.delete("/me/teachers/:teacherId", centerOnly, asyncHandler(removeCenterTeacher));

// ── Center: manage own staff (assistants) ────────────────────────────────────
router.get("/me/staff", centerOnly, asyncHandler(getCenterStaff));
router.post("/me/staff", centerOnly, asyncHandler(createCenterStaff));
router.patch("/me/staff/:staffId/reset-password", centerOnly, asyncHandler(resetStaffPassword));
router.patch("/me/staff/:staffId/transfer", centerOnly, asyncHandler(transferAssistant));
router.patch("/me/staff/:staffId/toggle-status", centerOnly, asyncHandler(toggleCenterStaffStatus));
router.patch("/me/staff/:staffId", centerOnly, asyncHandler(updateCenterStaff));
router.delete("/me/staff/:staffId", centerOnly, asyncHandler(deleteCenterStaff));
router.get("/me/teachers/:teacherId/assistants", centerOnly, asyncHandler(getCenterStaff));

// ── Center: financial report ──────────────────────────────────────────────────
router.get("/me/financial-report", centerOnly, asyncHandler(getCenterFinancialReport));

// ── Center: rooms ─────────────────────────────────────────────────────────────
router.get("/me/rooms", centerOnly, asyncHandler(getCenterRooms));
router.post("/me/rooms", centerOnly, asyncHandler(createCenterRoom));
router.patch("/me/rooms/:roomId/toggle", centerOnly, asyncHandler(toggleCenterRoomStatus));
router.patch("/me/rooms/:roomId", centerOnly, asyncHandler(updateCenterRoom));
router.delete("/me/rooms/:roomId", centerOnly, asyncHandler(deleteCenterRoom));

// ── Center: audit log ─────────────────────────────────────────────────────────
router.get("/me/audit-log", centerOnly, asyncHandler(getCenterAuditLog));

export default router;
