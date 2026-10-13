import { Router } from "express";
import { getBillTemplates, addBillTemplate, updateBillTemplate, deleteBillTemplate } from "../controllers/billTemplatesController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getBillTemplates));
router.post("/", asyncHandler(addBillTemplate));
router.patch("/:id", asyncHandler(updateBillTemplate));
router.delete("/:id", asyncHandler(deleteBillTemplate));

export default router;
