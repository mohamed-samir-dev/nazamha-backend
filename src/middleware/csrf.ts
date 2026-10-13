import { doubleCsrf } from "csrf-csrf";
import { Request, Response, NextFunction } from "express";

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || process.env.JWT_SECRET || "csrf-fallback-secret",
  getSessionIdentifier: (req: Request) => req.cookies?.token || req.ip || "",
  cookieName: "x-csrf-token",
  cookieOptions: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 64,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req: Request) =>
    (req.headers["x-csrf-token"] as string) || req.body?._csrf,
});

/** GET /api/csrf-token — يرجع token للـ frontend */
export const csrfTokenHandler = (req: Request, res: Response): void => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
};

const CSRF_EXEMPT = [
  "/api/auth/login",
  "/api/auth/admin-login",
  "/api/auth/center-login",
  "/api/auth/staff-login",
  "/api/auth/logout",
];

/** Middleware يحمي كل الـ state-changing routes (POST/PATCH/PUT/DELETE) */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (CSRF_EXEMPT.includes(req.path)) return next();
  doubleCsrfProtection(req, res, next);
};
