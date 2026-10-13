import type { Store, Options } from "express-rate-limit";
import { getRedisClient } from "../config/redis";
import { createHash } from "crypto";

/** Redis configured => all API instances share counters, without a local fallback. */
export function sharedRateStore(namespace: string): Store | undefined {
  if (!process.env.REDIS_URL) return undefined;
  let windowMs = 60_000;
  const keyFor = (key: string) => `rate:${namespace}:${createHash("sha256").update(key).digest("hex")}`;
  const client = async () => {
    const redis = await getRedisClient();
    if (!redis) throw new Error("Shared rate-limit store is unavailable");
    return redis;
  };
  return {
    localKeys: false,
    init(options: Options) { windowMs = options.windowMs; },
    async increment(key: string) {
      const result = await (await client()).eval(
        "local n=redis.call('INCR',KEYS[1]); local ttl=redis.call('PTTL',KEYS[1]); if ttl<0 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); ttl=tonumber(ARGV[1]); end; return {n,ttl}",
        1, keyFor(key), windowMs,
      ) as [number, number];
      return { totalHits: result[0], resetTime: new Date(Date.now() + result[1]) };
    },
    async decrement(key: string) {
      await (await client()).eval("if tonumber(redis.call('GET',KEYS[1]) or '0')>0 then redis.call('DECR',KEYS[1]); end", 1, keyFor(key));
    },
    async resetKey(key: string) { await (await client()).del(keyFor(key)); },
  };
}
