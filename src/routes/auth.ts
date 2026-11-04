import { Router } from "express";
import { login, adminLogin, centerLogin, staffLogin, getMe, changePassword, logout } from "../controllers/authController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// Login routes are rate-limited at app-level via sharedRateStore in app.ts with skipSuccessfulRequests
router.post("/login", asyncHandler(login));
router.post("/admin-login", asyncHandler(adminLogin));
router.post("/center-login", asyncHandler(centerLogin));
router.post("/staff-login", asyncHandler(staffLogin));

// Logout is unprotected so expired, inactive, or revoked sessions can always clear cookies cleanly
router.post("/logout", asyncHandler(logout));

router.get("/me", protect, asyncHandler(getMe));
router.patch("/change-password", protect, asyncHandler(changePassword));

export default router;
