import { Router, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { statusHandler, qrHandler, connectHandler, sendHandler, sendImageHandler, disconnectHandler } from "../controllers/whatsappController";
import { protect, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

// Guard: Only primary teachers (or admins) may initiate QR scanning or disconnect WhatsApp sessions.
// Assistants/staff are barred from managing session state.
const teacherOnlySession = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.staff_permissions !== undefined) {
    res.status(403).json({ message: "غير مصرح للمساعد بإدارة أو تعديل ربط جلسة الواتساب الخاصة بالمعلم" });
    return;
  }
  next();
};

// Rate limiter for WhatsApp outbound messages to protect against spam, abuse, and ban risks:
// 60 requests per 15 minutes per IP/user
const whatsappSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "تم تجاوز الحد المسموح به لإرسال رسائل الواتساب. يرجى الانتظار قليلاً." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/status", asyncHandler(statusHandler));
router.get("/qr", teacherOnlySession, asyncHandler(qrHandler));
router.post("/connect", teacherOnlySession, asyncHandler(connectHandler));
router.post("/disconnect", teacherOnlySession, asyncHandler(disconnectHandler));
router.post("/send", whatsappSendLimiter, asyncHandler(sendHandler));
router.post("/send-image", whatsappSendLimiter, asyncHandler(sendImageHandler));

export default router;
