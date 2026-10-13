import { Router } from "express";
import { getSalaries, addSalary, updateSalary, deleteSalary, confirmSalaryPayment } from "../controllers/salariesController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getSalaries));
router.post("/", asyncHandler(addSalary));
router.patch("/:id/pay", asyncHandler(confirmSalaryPayment));
router.patch("/:id", asyncHandler(updateSalary));
router.delete("/:id", asyncHandler(deleteSalary));

export default router;
