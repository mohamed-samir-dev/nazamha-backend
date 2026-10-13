import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getBanks, createBank, updateBank, deleteBank, duplicateBank, getQuestions, createQuestion, updateQuestion, deleteQuestion } from "../controllers/questionBanksController";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getBanks));
router.post("/", asyncHandler(createBank));
router.put("/:id", asyncHandler(updateBank));
router.post("/:id/duplicate", asyncHandler(duplicateBank));
router.get("/:bankId/questions", asyncHandler(getQuestions));
router.post("/:bankId/questions", asyncHandler(createQuestion));
router.delete("/:id", asyncHandler(deleteBank));

export default router;
