import crypto from "crypto";
import { TokenBlacklist } from "../models/TokenBlacklist";
import { getRedisClient } from "../config/redis";

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function revokeToken(rawToken: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  const th = hashToken(rawToken);

  try {
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(`bl:${th}`, "1", "EX", ttlSeconds);
    }
  } catch {
    // Non-fatal Redis error — MongoDB is the durable fallback store
  }

  await TokenBlacklist.updateOne(
    { token_hash: th },
    { $set: { expires_at: new Date(Date.now() + ttlSeconds * 1000) } },
    { upsert: true }
  );
}

export async function isTokenRevoked(rawToken: string): Promise<boolean> {
  const th = hashToken(rawToken);

  try {
    const redis = await getRedisClient();
    if (redis) {
      const exists = await redis.exists(`bl:${th}`);
      if (exists) return true;
    }
  } catch {
    // Fall back to MongoDB if Redis fails
  }

  return !!(await TokenBlacklist.findOne({
    token_hash: th,
    expires_at: { $gt: new Date() },
  }).lean());
}
