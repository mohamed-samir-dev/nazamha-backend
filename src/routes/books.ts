import { Router } from "express";
import { protect } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getBooks, getBookById, createBook, updateBook, deleteBook,
  getBookDetails, lookupStudentForSale, sellBook, sellByCode, cancelSale,
  getStudentBooks, getSales, getBooksReport, markSalePaid, sellExempt, getStudentBookCounts,
} from "../controllers/booksController";

const router = Router();
router.use(protect);

// Static routes first
router.get("/", asyncHandler(getBooks));
router.post("/", asyncHandler(createBook));
router.get("/report", asyncHandler(getBooksReport));
router.get("/sales", asyncHandler(getSales));
router.get("/sales-count", asyncHandler(getStudentBookCounts));
router.get("/lookup-student", asyncHandler(lookupStudentForSale));
router.post("/sell", asyncHandler(sellBook));
router.post("/sell-by-code", asyncHandler(sellByCode));
router.get("/student/:studentId", asyncHandler(getStudentBooks));
router.patch("/sales/:saleId/cancel", asyncHandler(cancelSale));
router.patch("/sales/:saleId/mark-paid", asyncHandler(markSalePaid));
router.post("/sell-exempt", asyncHandler(sellExempt));

// Dynamic :id routes last
router.get("/:id", asyncHandler(getBookById));
router.patch("/:id", asyncHandler(updateBook));
router.delete("/:id", asyncHandler(deleteBook));
router.get("/:id/details", asyncHandler(getBookDetails));

export default router;
