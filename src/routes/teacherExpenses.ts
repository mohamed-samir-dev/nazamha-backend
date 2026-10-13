import { Router } from "express";
import { 
  getTeacherExpenses, 
  getExpenseStatistics,
  addTeacherExpense, 
  updateTeacherExpense, 
  deleteTeacherExpense,
  confirmExpensePayment,
} from "../controllers/teacherExpensesController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getTeacherExpenses));
router.get("/statistics", asyncHandler(getExpenseStatistics));
router.post("/", asyncHandler(addTeacherExpense));
router.patch("/:id/pay", asyncHandler(confirmExpensePayment));
router.patch("/:id", asyncHandler(updateTeacherExpense));
router.delete("/:id", asyncHandler(deleteTeacherExpense));

export default router;
