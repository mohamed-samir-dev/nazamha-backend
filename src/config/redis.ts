import Redis from "ioredis";

// ── Redis connection ──────────────────────────────────────────────────────────
// Redis is optional. When REDIS_URL is not set or the connection fails, all
// callers fall back gracefully to MongoDB / in-memory paths.
// We never throw — Redis unavailability is a degraded-mode scenario, not fatal.

let client: Redis | null = null;
let connectionAttempted = false;

export async function getRedisClient(): Promise<Redis | null> {
  if (connectionAttempted) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[redis] REDIS_URL not set — running without Redis cache/blacklist");
    }
    connectionAttempted = true;
    return null;
  }

  try {
    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    await redis.connect();
    client = redis;
    console.log("[redis] Connected");

    redis.on("error", (err) => {
      // Log once per error burst, don't crash the process
      console.warn("[redis] Connection error:", err.message);
      client = null;
    });

    redis.on("reconnecting", () => {
      console.log("[redis] Reconnecting…");
    });

    redis.on("connect", () => {
      client = redis;
      console.log("[redis] Reconnected");
    });
  } catch (err: any) {
    console.warn("[redis] Could not connect:", err.message, "— falling back to in-memory/MongoDB");
    client = null;
  }

  connectionAttempted = true;
  return client;
}

/** Pre-warm the connection at startup (fire-and-forget). */
export async function connectRedis(): Promise<void> {
  await getRedisClient();
}
