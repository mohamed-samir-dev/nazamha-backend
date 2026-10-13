import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getExams, createExam, updateExam, deleteExam, getGrades, upsertGrades, findOrCreateByBank, getStudentExams, getAllStudentsExamGrades } from "../controllers/examsController";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getExams));
router.post("/", asyncHandler(createExam));
router.post("/find-or-create", asyncHandler(findOrCreateByBank));
router.patch("/:id", asyncHandler(updateExam));
router.delete("/:id", asyncHandler(deleteExam));
router.get("/all-grades", asyncHandler(getAllStudentsExamGrades));
router.get("/student/:studentId", asyncHandler(getStudentExams));
router.get("/:examId/grades", asyncHandler(getGrades));
router.post("/:examId/grades", asyncHandler(upsertGrades));

export default router;
