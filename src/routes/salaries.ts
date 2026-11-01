import { Router } from "express";
import { getSalaries, addSalary, updateSalary, deleteSalary, confirmSalaryPayment } from "../controllers/salariesController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);
router.use((req: any, res: any, next: any) => {
  if (req.user?.user_type === "staff" || req.user?.effective_teacher_id) {
    res.status(403).json({ message: "ليس لديك صلاحية لعرض أو تعديل الرواتب" });
    return;
  }
  next();
});

router.get("/", asyncHandler(getSalaries));
router.post("/", asyncHandler(addSalary));
router.patch("/:id/pay", asyncHandler(confirmSalaryPayment));
router.patch("/:id", asyncHandler(updateSalary));
router.delete("/:id", asyncHandler(deleteSalary));

export default router;
