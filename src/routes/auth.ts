import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, adminLogin, centerLogin, staffLogin, getMe, changePassword, logout } from "../controllers/authController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 50 : 200,
  message: { message: "محاولات كثيرة جداً، حاول مجدداً بعد 15 دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, asyncHandler(login));
router.post("/admin-login", loginLimiter, asyncHandler(adminLogin));
// center-login and staff-login now share the same loginLimiter as /login and /admin-login
router.post("/center-login", loginLimiter, asyncHandler(centerLogin));
router.post("/staff-login", loginLimiter, asyncHandler(staffLogin));
// protect required on logout so the token can be blacklisted (C2 fix)
router.post("/logout", protect, asyncHandler(logout));
router.get("/me", protect, asyncHandler(getMe));
router.patch("/change-password", protect, asyncHandler(changePassword));

export default router;
