import { atomicController, series } from "../services/atomicController";
import { findScannedStudent } from "../utils/studentScan";
import { Response } from "express";
import mongoose from "mongoose";
import { Book } from "../models/Book";
import { BookSale } from "../models/BookSale";
import { Student } from "../models/Student";
import { Group } from "../models/Group";
import { Grade } from "../models/Grade";
import { AuthRequest, teacherFilter } from "../middleware/auth";
import { invalidateDashboardCache } from "./dashboardController";

function resolveTeacherId(req: AuthRequest): string {
  if (req.user!.user_type === "center" || req.user!.user_type === "staff") {
    return (req.body.teacher_id as string) || req.user!.id;
  }
  return req.user!.is_admin ? (req.body.teacher_id || req.user!.id) : req.user!.id;
}

async function resolveStudentGradeId(student: any): Promise<string | null> {
  if (student.grade_id) return String(student.grade_id);
  if (student.group_id) {
    const group = await Group.findById(student.group_id).lean().select("grade_id");
    return group?.grade_id ? String(group.grade_id) : null;
  }
  return null;
}

async function checkStudentGradeMatchesBook(student: any, book: any): Promise<{ ok: boolean; message?: string }> {
  if (!book.grade_id) return { ok: true };
  const studentGradeId = await resolveStudentGradeId(student);
  if (!studentGradeId) {
    const bookGrade = await Grade.findById(book.grade_id).lean().select("name");
    return {
      ok: false,
      message: `هذا الكتاب مخصص لـ "صف ${(bookGrade as any)?.name ?? "غير معروف"}" — الطالب غير مسجّل في أي صف`,
    };
  }
  if (studentGradeId === String(book.grade_id)) return { ok: true };

  const [studentGrade, bookGrade] = await Promise.all([
    Grade.findById(studentGradeId).lean().select("name"),
    Grade.findById(book.grade_id).lean().select("name"),
  ]);
  return {
    ok: false,
    message: `هذا الكتاب مخصص لـ "صف ${(bookGrade as any)?.name ?? "غير معروف"}" — والطالب مسجّل في "صف ${(studentGrade as any)?.name ?? "غير معروف"}"`,
  };
}

async function generateUniqueCode(name: string, teacherId: string): Promise<string> {
  const prefix = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w.replace(/[^a-zA-Z\u0600-\u06FF]/g, "").slice(0, 3).toUpperCase())
    .filter(Boolean)
    .join("-") || "BK";

  for (let i = 0; i < 10; i++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const candidate = `${prefix}-${suffix}`;
    const exists = await Book.exists({ teacher_id: teacherId, code: candidate });
    if (!exists) return candidate;
  }
  // fallback: timestamp
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

export const getBooks = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  if (req.query.grade_id) (filter as any).grade_id = req.query.grade_id;
  if (req.query.status) (filter as any).status = req.query.status;
  if (req.query.code) (filter as any).code = { $regex: req.query.code, $options: "i" };
  if (req.query.academic_year) (filter as any).academic_year = req.query.academic_year;

  const books = await Book.find(filter).sort({ sort_order: 1, created_at: -1 }).lean();
  const bookIds = books.map((b) => b._id);

  const matchFilter: Record<string, unknown> = { book_id: { $in: bookIds }, status: "active" };
  if (!req.user!.is_super_admin && req.user!.is_admin) {
    matchFilter.teacher_id = { $in: req.user!.allowed_teacher_ids?.map(id => new mongoose.Types.ObjectId(id)) || [] };
  } else if (!req.user!.is_admin) {
    matchFilter.teacher_id = new mongoose.Types.ObjectId(req.user!.id);
  }

  const salesAgg = await BookSale.aggregate([
    { $match: matchFilter },
    { $group: { _id: "$book_id", buyers: { $sum: 1 }, revenue: { $sum: "$final_price" } } },
  ]);
  const salesMap = new Map(salesAgg.map((s) => [String(s._id), s]));

  const result = books.map(({ _id, __v, ...b }) => ({
    id: String(_id),
    ...b,
    buyers_count: salesMap.get(String(_id))?.buyers ?? 0,
    total_revenue: salesMap.get(String(_id))?.revenue ?? 0,
  }));

  res.json(result);
};

export const getBookById = async (req: AuthRequest, res: Response): Promise<void> => {
  const book = await Book.findOne({ _id: req.params.id, ...teacherFilter(req) }).lean();
  if (!book) { res.status(404).json({ message: "الكتاب غير موجود" }); return; }
  const { _id, __v, ...rest } = book as any;
  res.json({ id: String(_id), ...rest });
};

export const createBook = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, description, cover_image, grade_id, group_id, price, status, sort_order, code, academic_year } = req.body;
  if (!name || price == null) { res.status(400).json({ message: "الاسم والسعر مطلوبان" }); return; }
  const teacherId = resolveTeacherId(req);
  if (req.user!.is_admin && !req.user!.is_super_admin && !req.user!.allowed_teacher_ids?.includes(teacherId)) {
    res.status(403).json({ message: "ليس لديك صلاحية لإضافة كتاب لهذا المدرس" }); return;
  }
  const book = await Book.create({
    teacher_id: teacherId,
    name: name.trim(),
    description: description?.trim() || null,
    cover_image: cover_image || null,
    grade_id: grade_id || null,
    group_id: group_id || null,
    price: Number(price),
    status: status || "available",
    sort_order: sort_order ?? 0,
    code: code?.trim() || await generateUniqueCode(name, teacherId),
    academic_year: academic_year?.trim() || null,
  });
  const { _id, __v, ...rest } = book.toObject() as any;
  res.status(201).json({ id: String(_id), ...rest });
};

export const updateBook = async (req: AuthRequest, res: Response): Promise<void> => {
  const allowed = ["name", "description", "cover_image", "grade_id", "group_id", "price", "status", "sort_order", "code", "academic_year"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  if (updates.name) updates.name = (updates.name as string).trim();
  const book = await Book.findOneAndUpdate(
    { _id: req.params.id, ...teacherFilter(req) },
    updates,
    { new: true }
  );
  if (!book) { res.status(404).json({ message: "الكتاب غير موجود" }); return; }
  const { _id, __v, ...rest } = book.toObject() as any;
  res.json({ id: String(_id), ...rest });
};

export const deleteBook = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const hasSales = await BookSale.exists({ book_id: req.params.id, ...filter, status: "active" });
  if (hasSales) { res.status(400).json({ message: "لا يمكن حذف كتاب له مبيعات نشطة" }); return; }
  const book = await Book.findOneAndDelete({ _id: req.params.id, ...filter });
  if (!book) { res.status(404).json({ message: "الكتاب غير موجود" }); return; }
  res.json({ message: "تم حذف الكتاب" });
};

export const getBookDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const book = await Book.findOne({ _id: req.params.id, ...filter }).lean();
  if (!book) { res.status(404).json({ message: "الكتاب غير موجود" }); return; }

  // فلتر الطلاب على حسب grade_id بتاع الكتاب
  let studentFilter: Record<string, unknown> = { ...filter };
  if ((book as any).grade_id) {
    const gradeGroups = await Group.find({ ...filter, grade_id: (book as any).grade_id }).lean().select("_id");
    const gradeGroupIds = gradeGroups.map((g) => g._id);
    studentFilter = {
      ...filter,
      $or: [
        { grade_id: (book as any).grade_id },
        { group_id: { $in: gradeGroupIds } },
      ],
    };
  }

  const [students, sales] = await Promise.all([
    Student.find(studentFilter).lean().select("_id name code group_id"),
    BookSale.find({ book_id: req.params.id, ...filter, status: "active" }).lean(),
  ]);

  // Group sales by student — a student may have multiple sales (force_resell)
  const salesByStudent = new Map<string, typeof sales>();
  for (const s of sales) {
    const key = String(s.student_id);
    if (!salesByStudent.has(key)) salesByStudent.set(key, []);
    salesByStudent.get(key)!.push(s);
  }

  const rows: any[] = [];
  for (const s of students) {
    const studentSales = salesByStudent.get(String(s._id)) ?? [];
    if (studentSales.length === 0) {
      // Not purchased
      rows.push({
        student_id: String(s._id),
        name: (s as any).name,
        code: (s as any).code,
        group_id: String((s as any).group_id),
        purchased: false,
        paid: false,
        purchase_date: null,
        amount: null,
        final_price: null,
        discount: null,
        is_exempt: false,
        receipt_number: null,
        sale_id: null,
        extra_sales: [],
      });
    } else {
      // First (oldest) sale as the primary row
      const primary = studentSales[0];
      rows.push({
        student_id: String(s._id),
        name: (s as any).name,
        code: (s as any).code,
        group_id: String((s as any).group_id),
        purchased: true,
        paid: !primary.is_exempt,
        purchase_date: primary.created_at ?? null,
        amount: primary.price ?? null,
        final_price: primary.final_price ?? null,
        discount: primary.discount ?? null,
        is_exempt: primary.is_exempt ?? false,
        receipt_number: null,
        sale_id: String((primary as any)._id),
        // Additional sales beyond the first
        extra_sales: studentSales.slice(1).map((es) => ({
          sale_id: String((es as any)._id),
          purchase_date: es.created_at ?? null,
          amount: es.price ?? null,
          final_price: es.final_price ?? null,
          discount: es.discount ?? null,
          is_exempt: es.is_exempt ?? false,
        })),
      });
    }
  }

  const { _id, __v, ...bookData } = book as any;
  res.json({
    book: { id: String(_id), ...bookData },
    buyers_count: sales.length,
    total_revenue: sales.reduce((sum, s) => sum + s.final_price, 0),
    not_purchased_count: students.length - sales.length,
    students: rows,
  });
};

export const lookupStudentForSale = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const { student_code, book_id } = req.query as { student_code: string; book_id: string };
  if (!student_code || !book_id) { res.status(400).json({ message: "كود الطالب والكتاب مطلوبان" }); return; }

  const [student, book] = await Promise.all([
    findScannedStudent(filter, { student_code }),
    Book.findOne({ _id: book_id, ...filter }).lean(),
  ]);

  if (!student) { 
    res.status(404).json({ 
      message: `الطالب بكود "${student_code.trim()}" غير موجود أو غير مسجل في صفك`,
      error_code: "STUDENT_NOT_FOUND" 
    }); 
    return; 
  }
  if (!book) { 
    res.status(404).json({ 
      message: "الكتاب غير موجود",
      error_code: "BOOK_NOT_FOUND" 
    }); 
    return; 
  }

  const gradeCheck = await checkStudentGradeMatchesBook(student, book);
  if (!gradeCheck.ok) { res.status(422).json({ message: gradeCheck.message, error_code: "GRADE_MISMATCH" }); return; }

  const bookDiscPct = (student as any).book_discount_value ?? (student as any).family_book_discount_percent ?? 0;
  const isExempt = bookDiscPct >= 100;
  const discount = isExempt ? (book as any).price : Math.round((book as any).price * bookDiscPct / 100);
  const finalPrice = isExempt ? 0 : (book as any).price - discount;
  const discountReason = (student as any).book_discount_value != null ? (student as any).discount_reason || null : (student as any).family_book_discount_reason || null;

  const existingSale = await BookSale.findOne({
    ...filter,
    book_id,
    student_id: student._id,
    status: "active",
  }).lean().populate("subscription_id", "receipt_number");

  const { _id: sId, __v: _sv, ...studentData } = student as any;
  const { _id: bId, __v: _bv, ...bookData } = book as any;

  res.json({
    student: { id: String(sId), ...studentData },
    book: { id: String(bId), ...bookData },
    pricing: { price: (book as any).price, discount, discount_pct: bookDiscPct, is_exempt: isExempt, final_price: finalPrice, discount_reason: discountReason },
    already_purchased: existingSale ? {
      sale_id: String((existingSale as any)._id),
      purchase_date: existingSale.created_at,
      receipt_number: (existingSale.subscription_id as any)?.receipt_number ?? null,
      amount: existingSale.final_price,
    } : null,
  });
};

export const sellBook = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const teacherId = resolveTeacherId(req);
  if (req.user!.is_admin && !req.user!.is_super_admin && !req.user!.allowed_teacher_ids?.includes(teacherId)) {
    res.status(403).json({ message: "ليس لديك صلاحية لبيع كتاب لهذا المدرس" }); return;
  }
  const { book_id, student_id, force_resell } = req.body as { book_id: string; student_id: string; force_resell?: boolean };
  if (!book_id || !student_id) { res.status(400).json({ message: "book_id و student_id مطلوبان" }); return; }

  const [book, student] = await series([
    Book.findOne({ _id: book_id, ...filter }).lean(),
    Student.findOne({ _id: student_id, ...filter }).lean(),
  ]);

  if (!book) { res.status(404).json({ message: "الكتاب غير موجود" }); return; }
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
  if ((book as any).status === "unavailable") { res.status(400).json({ message: "الكتاب غير متاح للبيع" }); return; }

  const gradeCheck = await checkStudentGradeMatchesBook(student, book);
  if (!gradeCheck.ok) { res.status(422).json({ message: gradeCheck.message, error_code: "GRADE_MISMATCH" }); return; }

  await Student.updateOne({ _id: student!._id, ...filter }, { $inc: { mutation_version: 1 } });
  const existingSale = await BookSale.findOne({ ...filter, book_id, student_id, status: "active" }).lean();
  if (existingSale && !force_resell) {
    res.status(409).json({ message: "الطالب اشترى هذا الكتاب بالفعل", existing_sale_id: String((existingSale as any)._id) });
    return;
  }

  const bookDiscPct = (student as any).book_discount_value ?? (student as any).family_book_discount_percent ?? 0;
  const isExempt = bookDiscPct >= 100;
  const discount = isExempt ? (book as any).price : Math.round((book as any).price * bookDiscPct / 100);
  const finalPrice = isExempt ? 0 : (book as any).price - discount;
  const discountReason = (student as any).book_discount_value != null ? (student as any).discount_reason || null : (student as any).family_book_discount_reason || null;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const sale = await BookSale.create({
    teacher_id: teacherId,
    book_id,
    student_id,
    price: (book as any).price,
    discount,
    discount_reason: discountReason,
    final_price: finalPrice,
    is_exempt: isExempt,
    subscription_id: null,
    month,
    year,
    status: "active",
  });

  const { _id, __v, ...saleData } = sale.toObject() as any;
  invalidateDashboardCache(teacherId);
  res.status(201).json({ id: String(_id), ...saleData, message: "تم تسجيل البيع بنجاح" });
});

/**
 * POST /books/sell-by-code
 *
 * Unified endpoint: accepts student_code + book_id, runs every validation
 * server-side in a single round-trip, and either:
 *   • sells immediately (no discount, no prior sale) — status 201 + sale object
 *   • returns a "needs_confirmation" response when the teacher must confirm
 *     (discount present, student already purchased, or student is exempt)
 *
 * The frontend should inspect `needs_confirmation` and render the appropriate
 * UI. When the teacher confirms, it re-calls this endpoint with
 * `force_confirm: true` which proceeds to create the sale unconditionally
 * (except for an actual duplicate when `force_resell` is false).
 *
 * Security: all pricing, grade eligibility, ownership and duplicate checks
 * are performed server-side. The client never sends price or discount values.
 */
export const sellByCode = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const teacherId = resolveTeacherId(req);

  if (req.user!.is_admin && !req.user!.is_super_admin && !req.user!.allowed_teacher_ids?.includes(teacherId)) {
    res.status(403).json({ message: "ليس لديك صلاحية لبيع كتاب لهذا المدرس" }); return;
  }

  const { student_code, student_id: studentIdParam, book_id, force_resell = false } = req.body as {
    student_code?: string;
    student_id?: string;
    book_id: string;
    force_resell?: boolean;
  };

  if ((!student_code && !studentIdParam) || !book_id) {
    res.status(400).json({ message: "student_code أو student_id و book_id مطلوبان" }); return;
  }

  // ── 1. Fetch student + book in parallel ────────────────────────────────
  const [student, book] = await series([
    findScannedStudent(filter, { student_id: studentIdParam, student_code }),
    Book.findOne({ _id: book_id, ...filter }).lean(),
  ]);

  if (!student) {
    res.status(404).json({
      message: "الطالب غير موجود أو غير مسجل في صفك",
      error_code: "STUDENT_NOT_FOUND"
    });
    return;
  }
  if (!book) { 
    res.status(404).json({ 
      message: "الكتاب غير موجود",
      error_code: "BOOK_NOT_FOUND" 
    }); 
    return; 
  }
  if ((book as any).status === "unavailable") {
    res.status(400).json({ message: "الكتاب غير متاح للبيع" }); return;
  }

  // ── 2. Grade eligibility check (may do 1-3 extra DB reads if grades differ) ──
  const gradeCheck = await checkStudentGradeMatchesBook(student, book);
  if (!gradeCheck.ok) {
    res.status(422).json({ message: gradeCheck.message, error_code: "GRADE_MISMATCH" });
    return;
  }

  // ── 3. Compute pricing server-side ─────────────────────────────────────
  const bookDiscPct = (student as any).book_discount_value ?? (student as any).family_book_discount_percent ?? 0;
  const isExempt    = bookDiscPct >= 100;
  const discount    = isExempt ? (book as any).price : Math.round((book as any).price * bookDiscPct / 100);
  const finalPrice  = isExempt ? 0 : (book as any).price - discount;
  const discountReason = (student as any).book_discount_value != null ? (student as any).discount_reason || null : (student as any).family_book_discount_reason || null;

  // ── 4. Check for existing active sale ──────────────────────────────────
  await Student.updateOne({ _id: student!._id, ...filter }, { $inc: { mutation_version: 1 } });
  const existingSale = await BookSale.findOne({
    ...filter,
    book_id,
    student_id: (student as any)._id,
    status: "active",
  }).lean();

  const pricing = {
    price: (book as any).price,
    discount,
    discount_pct: bookDiscPct,
    is_exempt: isExempt,
    final_price: finalPrice,
    discount_reason: discountReason,
  };

  const studentSummary = {
    id: String((student as any)._id),
    name: (student as any).name,
    code: (student as any).code,
  };

  const bookSummary = {
    id: String((book as any)._id),
    name: (book as any).name,
    price: (book as any).price,
  };

  // ── 5. Needs-confirmation cases ─────────────────────────────────────────
  // Case A: already purchased and caller did not set force_resell
  if (existingSale && !force_resell) {
    res.status(200).json({
      needs_confirmation: true,
      reason: "already_purchased",
      student: studentSummary,
      book: bookSummary,
      pricing,
      already_purchased: {
        sale_id: String((existingSale as any)._id),
        purchase_date: (existingSale as any).created_at,
        amount: existingSale.final_price,
      },
    });
    return;
  }

  // Case B: student has a discount or is exempt — show pricing for confirmation
  // unless force_resell is set (meaning the teacher already saw and confirmed)
  if (!force_resell && (isExempt || discount > 0)) {
    res.status(200).json({
      needs_confirmation: true,
      reason: "has_discount",
      student: studentSummary,
      book: bookSummary,
      pricing,
      already_purchased: null,
    });
    return;
  }

  // ── 6. Proceed to create the sale ──────────────────────────────────────
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  const sale = await BookSale.create({
    teacher_id: teacherId,
    book_id,
    student_id: (student as any)._id,
    price: (book as any).price,
    discount,
    discount_reason: discountReason,
    final_price: finalPrice,
    is_exempt: isExempt,
    subscription_id: null,
    month,
    year,
    status: "active",
  });

  const { _id, __v, ...saleData } = sale.toObject() as any;
  invalidateDashboardCache(teacherId);

  res.status(201).json({
    needs_confirmation: false,
    sale: { id: String(_id), ...saleData },
    student: studentSummary,
    book: bookSummary,
    pricing,
    message: "تم تسجيل البيع بنجاح",
  });
});

export const markSalePaid = async (req: AuthRequest, res: Response): Promise<void> => {
  const sale = await BookSale.findOne({ _id: req.params.saleId, ...teacherFilter(req), status: "active" }).lean();
  if (!sale) { res.status(404).json({ message: "عملية البيع غير موجودة" }); return; }
  res.json({ message: "تم تسجيل الدفع" });
};

export const sellExempt = atomicController(async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const teacherId = resolveTeacherId(req);
  const { book_id, student_id } = req.body as { book_id: string; student_id: string };
  if (!book_id || !student_id) { res.status(400).json({ message: "book_id و student_id مطلوبان" }); return; }

  const [book, student] = await series([
    Book.findOne({ _id: book_id, ...filter }).lean(),
    Student.findOne({ _id: student_id, ...filter }).lean(),
  ]);
  if (!book) { res.status(404).json({ message: "الكتاب غير موجود" }); return; }
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }
  if ((book as any).status === "unavailable") { res.status(400).json({ message: "الكتاب غير متاح للبيع" }); return; }

  await Student.updateOne({ _id: student!._id, ...filter }, { $inc: { mutation_version: 1 } });
  const existing = await BookSale.findOne({ ...filter, book_id, student_id, status: "active" }).lean();
  if (existing) {
    await BookSale.findByIdAndUpdate((existing as any)._id, { is_exempt: true, discount: (book as any).price, final_price: 0 });
    res.json({ message: "تم تحديث البيع كإعفاء" }); return;
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const sale = await BookSale.create({
    teacher_id: teacherId, book_id, student_id,
    price: (book as any).price, discount: (book as any).price, final_price: 0,
    is_exempt: true, subscription_id: null, month, year, status: "active",
  });
  const { _id, __v, ...saleData } = sale.toObject() as any;
  invalidateDashboardCache(teacherId);
  res.status(201).json({ id: String(_id), ...saleData, message: "تم تسجيل الإعفاء" });
});

export const cancelSale = async (req: AuthRequest, res: Response): Promise<void> => {
  const { cancel_reason } = req.body;
  const sale = await BookSale.findOneAndUpdate(
    { _id: req.params.saleId, ...teacherFilter(req), status: "active" },
    { status: "cancelled", cancelled_at: new Date(), cancel_reason: cancel_reason || null },
    { new: true }
  );
  if (!sale) { res.status(404).json({ message: "عملية البيع غير موجودة" }); return; }
  invalidateDashboardCache(req.user!.id);
  res.json({ message: "تم إلغاء البيع", sale });
};

export const getStudentBooks = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const { studentId } = req.params;
  const student = await Student.findOne({ _id: studentId, ...filter }).lean();
  if (!student) { res.status(404).json({ message: "الطالب غير موجود" }); return; }

  const studentGradeId = await resolveStudentGradeId(student);
  const bookFilter: Record<string, unknown> = { ...filter, status: "available" };
  if (studentGradeId) bookFilter.grade_id = studentGradeId;

  const [books, sales] = await Promise.all([
    Book.find(bookFilter).sort({ sort_order: 1 }).lean(),
    BookSale.find({ student_id: studentId, ...filter, status: "active" }).lean(),
  ]);

  const salesMap = new Map(sales.map((s) => [String(s.book_id), s]));
  const result = books.map(({ _id, __v, ...b }) => {
    const sale = salesMap.get(String(_id));
    const sub = sale?.subscription_id as any;
    return {
      book_id: String(_id),
      ...b,
      purchased: !!sale,
      paid: !!sale && !sale.is_exempt,
      amount: sale?.final_price ?? null,
      discount: sale?.discount ?? null,
      is_exempt: sale?.is_exempt ?? false,
      receipt_number: null,
      purchase_date: sale?.created_at ?? null,
      sale_id: sale ? String((sale as any)._id) : null,
    };
  });
  res.json(result);
};

export const getStudentBookCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  const matchFilter: Record<string, unknown> = { status: "active" };
  if (!req.user!.is_super_admin && req.user!.is_admin) {
    matchFilter.teacher_id = { $in: req.user!.allowed_teacher_ids?.map(id => new mongoose.Types.ObjectId(id)) || [] };
  } else if (!req.user!.is_admin) {
    matchFilter.teacher_id = new mongoose.Types.ObjectId(req.user!.id);
  }
  if (req.query.student_ids !== undefined) {
    const ids = String(req.query.student_ids).split(",").filter(Boolean);
    if (ids.length > 500 || ids.some(id => !mongoose.isValidObjectId(id))) { res.status(400).json({ message: "قائمة الطلاب غير صحيحة" }); return; }
    matchFilter.student_id = { $in: ids.map(id => new mongoose.Types.ObjectId(id)) };
  }
  const agg = await BookSale.aggregate([
    { $match: matchFilter },
    { $group: { _id: "$student_id", bookIds: { $addToSet: "$book_id" } } },
  ]);
  const result: Record<string, string[]> = {};
  for (const row of agg) result[String(row._id)] = row.bookIds.map(String);
  res.json(result);
};

export const getSales = async (req: AuthRequest, res: Response): Promise<void> => {
  const query: Record<string, unknown> = { ...teacherFilter(req) };

  // Status filter: defaults to "active" for backward compatibility;
  // pass ?status=all to get both active and cancelled (needed by historical reports)
  const statusParam = req.query.status as string | undefined;
  if (statusParam === "all") {
    // no status filter — return all
  } else if (statusParam) {
    query.status = statusParam;
  } else {
    query.status = "active"; // default: backward-compatible
  }

  if (req.query.book_id) query.book_id = req.query.book_id;
  if (req.query.month) query.month = Number(req.query.month);
  if (req.query.year) query.year = Number(req.query.year);

  const sales = await BookSale.find(query)
    .sort({ created_at: -1 })
    .populate("book_id", "name price")
    .populate("student_id", "name code group_id")
    .populate("subscription_id", "receipt_number status")
    .lean();

  const result = sales.map(({ _id, __v, ...s }) => ({ id: String(_id), ...s }));
  res.json(result);
};

export const getBooksReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = teacherFilter(req);
  const matchFilter: Record<string, unknown> = { status: "active" };
  if (!req.user!.is_super_admin && req.user!.is_admin) {
    matchFilter.teacher_id = { $in: req.user!.allowed_teacher_ids?.map(id => new mongoose.Types.ObjectId(id)) || [] };
  } else if (!req.user!.is_admin) {
    matchFilter.teacher_id = new mongoose.Types.ObjectId(req.user!.id);
  }
  // Optional year filter for report scope
  if (req.query.year) matchFilter.year = Number(req.query.year);

  const [totalBooks, salesAgg, studentsCount, buyerCountAgg] = await Promise.all([
    Book.countDocuments({ ...filter, status: "available" }),
    BookSale.aggregate([
      { $match: matchFilter },
      { $group: { _id: "$book_id", sales_count: { $sum: 1 }, revenue: { $sum: "$final_price" }, total_discount: { $sum: "$discount" }, exempt_count: { $sum: { $cond: ["$is_exempt", 1, 0] } } } },
      { $sort: { sales_count: -1 } },
    ]),
    Student.countDocuments(filter),
    // Use aggregation instead of distinct() to get the unique buyer count server-side
    // avoids loading a large array of IDs into the application layer
    BookSale.aggregate([
      { $match: matchFilter },
      { $group: { _id: "$student_id" } },
      { $count: "unique_buyers" },
    ]),
  ]);

  const totalSales = salesAgg.reduce((s, a) => s + a.sales_count, 0);
  const totalRevenue = salesAgg.reduce((s, a) => s + a.revenue, 0);
  const totalDiscount = salesAgg.reduce((s, a) => s + a.total_discount, 0);
  const totalExempt = salesAgg.reduce((s, a) => s + a.exempt_count, 0);
  const uniqueBuyersCount: number = buyerCountAgg[0]?.unique_buyers ?? 0;

  const bestBookId = salesAgg[0]?._id;
  const bestBook = bestBookId ? await Book.findById(bestBookId).lean().then((b) => b ? { id: String((b as any)._id), name: (b as any).name, sales: salesAgg[0].sales_count } : null) : null;

  const notBoughtCount = studentsCount - uniqueBuyersCount;

  const bookIds = salesAgg.map((a) => a._id);
  const books = await Book.find({ _id: { $in: bookIds } }).lean().select("_id name price");
  const booksMap = new Map(books.map((b) => [String((b as any)._id), b]));

  const perBook = salesAgg.map((a) => {
    const b = booksMap.get(String(a._id)) as any;
    return { book_id: String(a._id), name: b?.name, price: b?.price, sales_count: a.sales_count, revenue: a.revenue, discount: a.total_discount, exempt_count: a.exempt_count };
  });

  res.json({ total_books: totalBooks, total_sales: totalSales, total_revenue: totalRevenue, total_discount: totalDiscount, total_exempt: totalExempt, best_book: bestBook, not_bought_count: notBoughtCount, unique_buyers: uniqueBuyersCount, per_book: perBook });
};


