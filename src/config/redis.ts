import Redis from "ioredis";

// ── Redis connection ──────────────────────────────────────────────────────────
// Redis is optional. Individual consumers decide whether absence permits a
// fallback; shared rate limiting intentionally fails closed when configured.

let client: Redis | null = null;
let connectionAttempted = false;
let pendingConnection: Promise<Redis | null> | null = null;

export async function getRedisClient(): Promise<Redis | null> {
  if (connectionAttempted) return client;
  if (!pendingConnection) pendingConnection = connectClient().finally(() => { pendingConnection = null; });
  return pendingConnection;
}

async function connectClient(): Promise<Redis | null> {
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

    redis.on("error", (err) => {
      // Log once per error burst, don't crash the process
      console.warn("[redis] Connection error:", err.message);
      client = null;
    });

    redis.on("reconnecting", () => {
      console.log("[redis] Reconnecting…");
    });

    redis.on("ready", () => {
      client = redis;
      console.log("[redis] Ready");
    });
    redis.on("close", () => { client = null; });
    await redis.connect();
    client = redis;
  } catch (err: any) {
    console.warn("[redis] Could not connect:", err.message);
    client = null;
  }

  connectionAttempted = true;
  return client;
}

/** Pre-warm the connection at startup (fire-and-forget). */
export async function connectRedis(): Promise<void> {
  await getRedisClient();
}
