import crypto from "crypto";
import { TokenBlacklist } from "../models/TokenBlacklist";
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
// MongoDB is the single durable source of truth. An unavailable store fails closed.
export async function revokeToken(rawToken: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  await TokenBlacklist.updateOne({ token_hash: hashToken(rawToken) },
    { $set: { expires_at: new Date(Date.now() + ttlSeconds * 1000) } }, { upsert: true });
}
export async function isTokenRevoked(rawToken: string): Promise<boolean> {
  return !!await TokenBlacklist.findOne({ token_hash: hashToken(rawToken), expires_at: { $gt: new Date() } }).lean();
}
