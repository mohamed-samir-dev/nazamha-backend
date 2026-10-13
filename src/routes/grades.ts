import { Router } from "express";
import { getGrades, addGrade, updateGrade, deleteGrade } from "../controllers/gradesController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getGrades));
router.post("/", asyncHandler(addGrade));
router.patch("/:id", asyncHandler(updateGrade));
router.delete("/:id", asyncHandler(deleteGrade));

export default router;
