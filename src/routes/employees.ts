import { Router } from "express";
import {
  getEmployees,
  getEmployeeById,
  getEmployeeHistory,
  addEmployee,
  updateEmployee,
  toggleEmployeeStatus,
} from "../controllers/employeesController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.use((req: any, res: any, next: any) => {
  if (req.user?.user_type === "staff" || req.user?.effective_teacher_id) {
    res.status(403).json({ message: "غير مصرح للمساعدين بالوصول إلى إدارة الموظفين" });
    return;
  }
  next();
});

router.get("/", asyncHandler(getEmployees));
router.get("/:id", asyncHandler(getEmployeeById));
router.get("/:id/history", asyncHandler(getEmployeeHistory));
router.post("/", asyncHandler(addEmployee));
router.put("/:id", asyncHandler(updateEmployee));
router.patch("/:id", asyncHandler(updateEmployee));
router.patch("/:id/toggle-status", asyncHandler(toggleEmployeeStatus));

export default router;
