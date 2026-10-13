import { Router } from "express";
import { getBills, addBill, addBills, updateBill, deleteBill, deleteBills, generateRecurringBills, deleteRecurringBillsForMonth } from "../controllers/billsController";
import { protect } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getBills));
router.post("/", auditLog("bill.create", "Bill"), asyncHandler(addBill));
router.post("/bulk", auditLog("bill.create", "Bill"), asyncHandler(addBills));
router.post("/bulk-delete", asyncHandler(deleteBills));
router.post("/generate-recurring", asyncHandler(generateRecurringBills));
router.delete("/recurring/:month", asyncHandler(deleteRecurringBillsForMonth));
router.patch("/:id", asyncHandler(updateBill));
router.delete("/:id", asyncHandler(deleteBill));

export default router;
