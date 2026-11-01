import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { uploadExamImage } from "../middleware/upload";
import {
  getBanks,
  createBank,
  updateBank,
  deleteBank,
  duplicateBank,
  getQuestions,
  createQuestion,
  reorderQuestions,
  bulkUpdateMarks,
  uploadQuestionImage,
} from "../controllers/questionBanksController";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getBanks));
router.post("/", asyncHandler(createBank));
router.post("/upload-image", uploadExamImage.single("image"), asyncHandler(uploadQuestionImage));
router.put("/:id", asyncHandler(updateBank));
router.post("/:id/duplicate", asyncHandler(duplicateBank));
router.get("/:bankId/questions", asyncHandler(getQuestions));
router.post("/:bankId/questions", asyncHandler(createQuestion));
router.put("/:bankId/questions/reorder", asyncHandler(reorderQuestions));
router.put("/:bankId/questions/marks", asyncHandler(bulkUpdateMarks));
router.delete("/:id", asyncHandler(deleteBank));

export default router;
