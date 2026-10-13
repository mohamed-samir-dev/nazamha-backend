import { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";
import type { StaffPermission } from "../models/CenterStaff";
import type { FinancialPermission } from "../models/Admin";

/** Module permissions supplement (never replace) ownership checks in controllers. */
export function enforceResourcePermissions(req: AuthRequest, res: Response, next: NextFunction): void {
  const u = req.user!;
  const module = req.baseUrl.replace(/^\/api\//, "");
  const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const deny = () => { res.status(403).json({ message: "ليس لديك صلاحية لهذه العملية" }); };
  const staffMap: Record<string, StaffPermission> = { students: "students", groups: "groups", grades: "groups",
    attendance: "attendance", subscriptions: "payments", books: "payments", bills: "payments", "bill-templates": "payments",
    salaries: "payments", "teacher-expenses": "payments", exams: "exams", questions: "exams", "question-banks": "exams",
    dashboard: "reports", whatsapp: "reports", "sub-teachers": "teachers" };
  if (u.staff_permissions !== undefined) {
    if (module === "students" && req.path.endsWith("/share-token") && !u.staff_permissions.includes("reports")) return deny();
    if (write && ["groups", "teachers"].includes(module) && req.body?.monthly_price !== undefined && !u.staff_permissions.includes("payments")) return deny();
    if (module === "dashboard" && req.path === "/payments" && !u.staff_permissions.some(p => p === "payments" || p === "reports")) return deny();
    // Auth targets the real staff account; center routes retain their own guards.
    if (module === "teachers") { if (write || req.path !== "/me") return deny(); }
    else if (module !== "auth" && module !== "centers") {
      const required = staffMap[module];
      const readDependencies: Record<string, StaffPermission[]> = {
        students: ["students", "attendance", "payments", "exams", "reports"],
        groups: ["groups", "students", "attendance", "payments", "exams", "reports"],
        grades: ["groups", "students", "attendance", "payments", "exams", "reports"],
        dashboard: ["students", "groups", "attendance", "payments", "exams", "reports"],
      };
      const allowed = !write && readDependencies[module]
        ? readDependencies[module].some(p => u.staff_permissions!.includes(p))
        : required && u.staff_permissions.includes(required);
      if (!allowed) return deny();
    }
    const studentPayloads = Array.isArray(req.body) ? req.body : [req.body, ...(Array.isArray(req.body?.students) ? req.body.students : [])];
    if (module === "students" && write && (req.path.includes("discount") || studentPayloads.some(payload => Object.keys(payload || {}).some(k => /discount|price|months|books/.test(k)))) && !u.staff_permissions.includes("payments")) return deny();
  }
  if (u.is_admin && !u.is_super_admin) {
    const requireAll = (...permissions: FinancialPermission[]) => permissions.every(p => u.financial_permissions.includes(p));
    if (["bills", "bill-templates"].includes(module) && !requireAll(write ? "financial.editInvoices" : "financial.viewInvoices")) return deny();
    if (["subscriptions", "salaries", "teacher-expenses"].includes(module) && !requireAll(write ? "financial.editInvoices" : "financial.viewRevenue")) return deny();
    if (module === "subscriptions" && (req.body?.status === "exempt" || req.body?.updates?.some?.((x: { status?: string }) => x.status === "exempt")) && !requireAll("financial.applyExemption")) return deny();
    if (module === "books") {
      if (!requireAll(write ? "financial.editInvoices" : "financial.viewRevenue")) return deny();
      if ((req.body?.price !== undefined) && !requireAll("financial.editBookPrice")) return deny();
      if (req.path === "/sell-exempt" && !requireAll("financial.applyExemption")) return deny();
    }
    if (module === "dashboard" && !requireAll("financial.viewRevenue")) return deny();
    if (module === "students" && write && (req.path.includes("discount") || Object.keys(req.body || {}).some(k => /discount|price/.test(k))) && !requireAll("financial.applyDiscount")) return deny();
    if (module === "teachers" && write && ["password", "hidden_from_admin", "is_active", "plan_id", "features", "subscription_price", "subscription_expires_at"].some(k => k in (req.body || {}))) return deny();
  }
  const canReadFinance = u.staff_permissions !== undefined
    ? u.staff_permissions.some(p => p === "payments" || p === "reports")
    : !u.is_admin || u.is_super_admin || u.financial_permissions.includes("financial.viewRevenue");
  if (!canReadFinance && ["students", "groups", "teachers", "dashboard"].includes(module)) {
    const json = res.json.bind(res);
    const redact = (value: any): any => {
      if (value == null || typeof value !== "object" || value instanceof Date) return value;
      if (Array.isArray(value)) return value.map(redact);
      const plain = typeof value.toJSON === "function" ? value.toJSON() : value;
      if (typeof plain !== "object" || plain === null) return plain;
      return Object.fromEntries(Object.entries(plain).filter(([key]) => !/price|discount|^months$|received_books|financial_permissions|subscription_price|subscription_expires_at/.test(key)).map(([key, item]) => [key, redact(item)]));
    };
    res.json = body => json(redact(body));
  }
  next();
}
