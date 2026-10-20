import "dotenv/config";
import { auditRequest } from "./middleware/auditLog";
import { sharedRateStore } from "./services/sharedRateStore";
import { validateEnv } from "./config/validateEnv";
validateEnv(); // fail-fast if required env vars are missing
import express from "express";import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import http from "http";

// ── Global process-level safety net ──────────────────────────────────────────
// Catches any Promise rejection that was not caught by a .catch() or try/catch.
// We log it and let the process manager (PM2 / Railway) restart if needed.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[process] unhandledRejection:", reason);
});

// Catches synchronous throws that escaped all try/catch blocks.
// We log, then exit so the process manager can restart cleanly.
process.on("uncaughtException", (err: Error) => {
  console.error("[process] uncaughtException:", err);
  process.exit(1);
});

import { csrfProtection, csrfTokenHandler } from "./middleware/csrf";
import { connectDB, disconnectDB } from "./config/db";
import { connectRedis, getRedisClient } from "./config/redis";
import { scheduleAutoAbsent } from "./workers/autoAbsent";
import mongoose from "mongoose";
import { scheduleRecurringGeneration } from "./utils/recurringCron";
import { buildLocalDate, getTodayInTimezone, getDayOfWeekInTimezone } from "./utils/timezoneUtils";
import { errorHandler, notFound } from "./middleware/errorHandler";

import authRoutes from "./routes/auth";
import teachersRoutes from "./routes/teachers";
import studentsRoutes from "./routes/students";
import groupsRoutes from "./routes/groups";
import gradesRoutes from "./routes/grades";
import attendanceRoutes from "./routes/attendance";
import billsRoutes from "./routes/bills";
import plansRoutes from "./routes/plans";
import subTeachersRoutes from "./routes/subTeachers";
import systemSettingsRoutes from "./routes/systemSettings";
import billTemplatesRoutes from "./routes/billTemplates";
import subscriptionsRoutes from "./routes/subscriptions";
import dashboardRoutes from "./routes/dashboard";
import booksRoutes from "./routes/books";
import adminsRoutes from "./routes/admins";
import salariesRoutes from "./routes/salaries";
import teacherExpensesRoutes from "./routes/teacherExpenses";
import whatsappRoutes from "./routes/whatsapp";
import questionBanksRoutes from "./routes/questionBanks";
import questionsRoutes from "./routes/questions";
import examsRoutes from "./routes/exams";
import publicRoutes from "./routes/public";
import centersRoutes from "./routes/centers";

const app = express();
app.set("trust proxy", 1);

// Security
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000").split(",").map(o => o.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), credentials: true }));
app.use(rateLimit({ store: sharedRateStore("global"), windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 2000 : 5000, message: "طلبات كثيرة جداً، حاول بعد قليل" }));

// Auth-specific rate limits — applied to exact paths before routes are mounted
app.use("/api/auth/login", rateLimit({ store: sharedRateStore("teacher-login"), windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 50 : 100, message: "محاولات كثيرة جداً، حاول بعد 15 دقيقة", skipSuccessfulRequests: true }));
app.use("/api/auth/admin-login", rateLimit({ store: sharedRateStore("admin-login"), windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 20 : 100, message: "محاولات كثيرة جداً، حاول بعد 15 دقيقة", skipSuccessfulRequests: true }));
app.use("/api/auth/center-login", rateLimit({ store: sharedRateStore("center-login"), windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 20 : 100, message: "محاولات كثيرة جداً، حاول بعد 15 دقيقة", skipSuccessfulRequests: true }));
app.use("/api/auth/staff-login", rateLimit({ store: sharedRateStore("staff-login"), windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 20 : 100, message: "محاولات كثيرة جداً، حاول بعد 15 دقيقة", skipSuccessfulRequests: true }));


// Logging & parsing
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use((req, res, next) => {
  if (req.headers["content-type"]?.startsWith("multipart/")) return next();
  express.json({ limit: "20mb" })(req, res, next);
});
app.use(cookieParser());
app.get("/api/csrf-token", csrfTokenHandler);
app.use(csrfProtection);

// Root
app.get("/", (_req, res) => res.json({ message: "Nazamha API is running 🚀" }));

// Routes
app.use(auditRequest);
app.use("/api/auth", authRoutes);
app.use("/api/teachers", teachersRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/groups", groupsRoutes);
app.use("/api/grades", gradesRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/bills", billsRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/sub-teachers", subTeachersRoutes);
app.use("/api/settings", systemSettingsRoutes);
app.use("/api/bill-templates", billTemplatesRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/books", booksRoutes);
app.use("/api/admins", adminsRoutes);
app.use("/api/salaries", salariesRoutes);
app.use("/api/teacher-expenses", teacherExpensesRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/question-banks", questionBanksRoutes);
app.use("/api/questions", questionsRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/centers", centersRoutes);

app.get("/api/ready", async (_req, res) => {
  const database = mongoose.connection.readyState === 1;
  const sharedCounters = !process.env.REDIS_URL || (await getRedisClient())?.status === "ready";
  const ready = database && sharedCounters;
  res.status(ready ? 200 : 503).json({ ready, database, sharedCounters });
});
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Socket inactivity timeout; business writes are protected separately.
// Prevents hung requests from holding connections open indefinitely
// when MongoDB is slow or an external service stalls.
const REQUEST_TIMEOUT_MS = 30_000;


// Cron: auto-mark absent for sessions that ended 1 hour ago with no attendance recorded

connectDB()
  .then(() => {
    // Pre-warm Redis connection (fire-and-forget — unavailability is non-fatal)
    connectRedis().catch((err) => console.warn("[startup] Redis pre-warm failed:", err.message));

    const server = http.createServer(app);
    // Hard timeout on the HTTP server: closes the socket after 30 s.
    // Individual route handlers should resolve well before this.
    server.setTimeout(REQUEST_TIMEOUT_MS);
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    const stopAbsent = process.env.RUN_WORKERS !== "false" ? scheduleAutoAbsent() : () => {};
    const stopRecurring = process.env.RUN_WORKERS !== "false" ? scheduleRecurringGeneration() : () => {};

    let stopping = false;
    const shutdown = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      console.log(`[${signal}] Shutting down gracefully...`);
      try {
        await Promise.all([
          stopAbsent(), stopRecurring(),
          new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
        ]);
        await disconnectDB();
        process.exit(0);
      } catch (error) {
        console.error("[shutdown] failed", error);
        process.exit(1);
      }
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => { console.error("Failed to connect to DB:", err); process.exit(1); });

export default app;
