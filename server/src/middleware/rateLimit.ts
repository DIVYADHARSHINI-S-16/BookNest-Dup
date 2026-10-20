import type { Request, Response, NextFunction } from "express";
import { redisClient } from "../config/redis";
import { clientKeyFromIp } from "../utils/clientIp";

/**
 * Rate limiter for the PUBLIC discovery endpoints
 * (POST /api/stores/nearby, GET /api/stores/:storeId/books).
 *
 * - Fixed window, counted per client. Both endpoints share ONE bucket per client,
 *   so alternating between them cannot double the allowance.
 * - Counters live in Redis when it is connected (shared by every server
 *   instance) and in a bounded in-memory map otherwise, or whenever a Redis call
 *   fails (same fallback pattern as utils/loginRateLimiter.ts). The memory
 *   fallback is per server process, so with several instances and Redis down the
 *   effective limit is multiplied by the instance count.
 * - The client is `req.ip`, which Express derives from the socket unless the
 *   app's "trust proxy" setting (env TRUST_PROXY) is configured. X-Forwarded-For
 *   is therefore never trusted by default. IPv6 clients are counted per /64.
 * - Only the client address and a counter are kept, for one window. Request
 *   bodies, query strings and coordinates are never read, stored or logged here.
 * - This runs only on the two public routes. Login (its own limiter), cart,
 *   checkout, orders and store-owner routes are not touched.
 *
 * Configuration (read on every request, so it can be changed in tests):
 *   DISCOVERY_RATE_LIMIT_MAX             requests per window per client (default 60, allowed 1-100000)
 *   DISCOVERY_RATE_LIMIT_WINDOW_SECONDS  window length in seconds       (default 60, allowed 1-3600)
 * A missing or invalid value falls back to the default. There is deliberately
 * no "0 = off" switch; set a very large limit instead if you must.
 */
export const DEFAULT_DISCOVERY_MAX = 60;
export const DEFAULT_DISCOVERY_WINDOW_SECONDS = 60;

const KEY_PREFIX = "rl:discovery:";
const MAX_MEMORY_ENTRIES = 10000;

export interface DiscoveryRateLimitConfig {
  max: number;
  windowSeconds: number;
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

export function getDiscoveryRateLimitConfig(): DiscoveryRateLimitConfig {
  return {
    max: intFromEnv("DISCOVERY_RATE_LIMIT_MAX", DEFAULT_DISCOVERY_MAX, 1, 100000),
    windowSeconds: intFromEnv("DISCOVERY_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_DISCOVERY_WINDOW_SECONDS, 1, 3600),
  };
}

interface MemoryEntry {
  count: number;
  resetAt: number; // epoch ms
}
const memory = new Map<string, MemoryEntry>();

function sweepMemory(now: number): void {
  if (memory.size < MAX_MEMORY_ENTRIES) return;
  for (const [k, v] of memory) {
    if (v.resetAt <= now) memory.delete(k);
  }
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const excess = memory.size - MAX_MEMORY_ENTRIES + 1;
    let i = 0;
    for (const k of memory.keys()) {
      memory.delete(k);
      if (++i >= excess) break;
    }
  }
}

// Atomic: INCR, give the key a TTL on first use, and repair a key that somehow has
// no TTL (so a counter can never get stuck forever). Returns {count, secondsLeft}.
const REDIS_HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('TTL', KEYS[1])
if t < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end
return {c, t}
`;

interface Hit {
  count: number;
  secondsLeft: number;
}

async function registerHit(key: string, windowSeconds: number): Promise<Hit> {
  if (redisClient.isOpen) {
    try {
      const out = (await redisClient.eval(REDIS_HIT_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      })) as unknown;
      if (Array.isArray(out) && out.length === 2) {
        const count = Number(out[0]);
        const ttl = Number(out[1]);
        if (Number.isFinite(count) && count >= 1) {
          return { count, secondsLeft: Number.isFinite(ttl) && ttl > 0 ? ttl : windowSeconds };
        }
      }
    } catch {
      // Redis failed: fall through to the in-memory counter.
    }
  }
  const now = Date.now();
  sweepMemory(now);
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    memory.set(key, entry);
  }
  entry.count += 1;
  return { count: entry.count, secondsLeft: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

export async function discoveryRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  let hit: Hit;
  let cfg: DiscoveryRateLimitConfig;
  try {
    cfg = getDiscoveryRateLimitConfig();
    hit = await registerHit(KEY_PREFIX + clientKeyFromIp(req.ip ?? req.socket?.remoteAddress), cfg.windowSeconds);
  } catch {
    // The limiter must never take the public endpoints down. (registerHit already
    // falls back to memory; this only guards against an unexpected bug.)
    next();
    return;
  }

  res.set("RateLimit-Limit", String(cfg.max));
  res.set("RateLimit-Remaining", String(Math.max(0, cfg.max - hit.count)));
  res.set("RateLimit-Reset", String(hit.secondsLeft));

  if (hit.count > cfg.max) {
    res.set("Retry-After", String(hit.secondsLeft));
    res.set("Cache-Control", "no-store");
    // Fixed message: nothing from the request (coordinates, search text, address) is echoed back.
    res.status(429).json({
      error: "Too many requests. Please wait a moment and try again.",
      retryAfterSeconds: hit.secondsLeft,
    });
    return;
  }
  next();
}

/** Test helper: forget every discovery counter (memory and, if connected, Redis). */
export async function resetDiscoveryRateLimiter(): Promise<void> {
  memory.clear();
  if (redisClient.isOpen) {
    try {
      const keys = await redisClient.keys(`${KEY_PREFIX}*`);
      if (keys.length) await redisClient.del(keys);
    } catch {
      // nothing more to clear
    }
  }
}

/** Test helper: behave as if the current window has just ended. Same effect as a reset. */
export const expireDiscoveryRateLimiter = resetDiscoveryRateLimiter;
