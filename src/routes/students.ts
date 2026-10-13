import { Router } from "express";
import { getStudentMemberships } from "../controllers/students.crud.controller";
import { getStudentByQR, getStudents, getSiblings, lookupFamily, getPotentialSiblings, linkSiblings, renameFamiliy, unlinkSibling, transferFamily, setFamilyDiscount, getStudentById, addStudent, updateStudent, deleteStudent, deleteStudents, suspendStudent, unsuspendStudent, checkStudentSuspension, bulkAddStudents, createFamily, deleteFamily, getCenterStudentSuggestions } from "../controllers/studentsController";
import { generateShareToken, revokeShareToken } from "../controllers/students.shareToken.controller";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(getStudents));
router.get("/scan", asyncHandler(getStudentByQR));
router.get("/siblings", asyncHandler(getSiblings));
router.get("/potential-siblings", asyncHandler(getPotentialSiblings));
router.get("/lookup-family", asyncHandler(lookupFamily));
router.get("/center-match", asyncHandler(getCenterStudentSuggestions));
router.post("/create-family", asyncHandler(createFamily));
router.post("/link-siblings", asyncHandler(linkSiblings));
router.post("/rename-family", asyncHandler(renameFamiliy));
router.post("/family-discount", asyncHandler(setFamilyDiscount));
router.post("/unlink-sibling", asyncHandler(unlinkSibling));
router.post("/transfer-family", asyncHandler(transferFamily));
router.delete("/family/:familyId", asyncHandler(deleteFamily));
router.post("/", asyncHandler(addStudent));
router.post("/bulk-delete", asyncHandler(deleteStudents));
router.post("/bulk", asyncHandler(bulkAddStudents));
router.delete("/bulk", asyncHandler(deleteStudents));
router.get("/:id", asyncHandler(getStudentById));
router.get("/:id/memberships", asyncHandler(getStudentMemberships));
router.patch("/:id", asyncHandler(updateStudent));
router.delete("/:id", asyncHandler(deleteStudent));
router.post("/:id/suspend", asyncHandler(suspendStudent));
router.post("/:id/unsuspend", asyncHandler(unsuspendStudent));
router.get("/:id/suspension", asyncHandler(checkStudentSuspension));
router.post("/:id/share-token", asyncHandler(generateShareToken));
router.delete("/:id/share-token", asyncHandler(revokeShareToken));

export default router;
