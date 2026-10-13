import { Router } from "express";
import { getSubTeachers, addSubTeacher, deleteSubTeacher } from "../controllers/subTeachersController";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getSubTeachers));
router.post("/", asyncHandler(addSubTeacher));
router.delete("/:id", asyncHandler(deleteSubTeacher));

export default router;
