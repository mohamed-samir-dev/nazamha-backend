import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { deleteQuestion, updateQuestion } from "../controllers/questionBanksController";

const router = Router();
router.use(protect);

router.put("/:id", asyncHandler(updateQuestion));
router.delete("/:id", asyncHandler(deleteQuestion));

export default router;
