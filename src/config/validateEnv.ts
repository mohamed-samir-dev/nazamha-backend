// ── validateEnv ───────────────────────────────────────────────────────────────
// Validates required environment variables at startup.
// Calls process.exit(1) if any required variable is absent or empty so the
// server never starts in a misconfigured state (fail-fast pattern).
// Skipped in test environments where a full .env is not expected.

const REQUIRED_KEYS = [
  "MONGODB_URI",
  "JWT_SECRET",
  "NODE_ENV",
  "FRONTEND_URL",
] as const;

export function validateEnv(): void {
  if (process.env.NODE_ENV === "test") return;

  const missing: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    for (const key of missing) {
      console.error(`[startup] Missing required environment variable: ${key}`);
    }
    console.error("[startup] Server startup aborted. Set the missing variables in your .env file.");
    process.exit(1);
  }
}
