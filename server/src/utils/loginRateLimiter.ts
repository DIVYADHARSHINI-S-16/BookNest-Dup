import { redisClient } from "../config/redis";

/**
 * Failed-login limiter. Counts FAILED attempts only, using Redis when it is
 * available and an in-memory map otherwise (or whenever a Redis call fails).
 *
 * Three counters, all fixed-window so every block ends on its own:
 *   ip+email  - 5 failures per 15 min: stops guessing one account from one place
 *   ip        - 20 failures per 15 min: stops one place spraying many accounts
 *   email     - 50 failures per 15 min: backstop against distributed guessing
 *
 * The email-only limit is deliberately high and the tight limit is per IP, so
 * someone else typing wrong passwords for your address cannot lock you out of
 * your own account from a different IP. The window starts at the first failure
 * and is never extended, so nobody is blocked for longer than WINDOW_SECONDS.
 * A successful login clears the ip+email and email counters.
 */
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LIMIT_PER_IP_EMAIL = 5;
export const LIMIT_PER_IP = 20;
export const LIMIT_PER_EMAIL = 50;

const PREFIX = "login:fail:";
const MAX_MEMORY_ENTRIES = 10000;

interface MemoryEntry {
  count: number;
  resetAt: number; // epoch ms
}
const memory = new Map<string, MemoryEntry>();

function keys(ip: string, email: string) {
  const e = email.trim().toLowerCase();
  return {
    ipEmail: { key: `${PREFIX}ipemail:${ip}|${e}`, limit: LIMIT_PER_IP_EMAIL },
    ip: { key: `${PREFIX}ip:${ip}`, limit: LIMIT_PER_IP },
    email: { key: `${PREFIX}email:${e}`, limit: LIMIT_PER_EMAIL },
  };
}

function sweepMemory(now: number): void {
  if (memory.size < MAX_MEMORY_ENTRIES) return;
  for (const [k, v] of memory) {
    if (v.resetAt <= now) memory.delete(k);
  }
  // Still full of live entries: drop the oldest-inserted ones rather than grow.
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const excess = memory.size - MAX_MEMORY_ENTRIES + 1;
    let i = 0;
    for (const k of memory.keys()) {
      memory.delete(k);
      if (++i >= excess) break;
    }
  }
}

function memoryGet(key: string, now: number): MemoryEntry | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.resetAt <= now) {
    memory.delete(key);
    return null;
  }
  return entry;
}

/** Seconds until the counter for `key` expires, with its current count. */
async function readCounter(key: string): Promise<{ count: number; ttl: number }> {
  if (redisClient.isOpen) {
    try {
      const raw = await redisClient.get(key);
      if (raw) {
        const ttl = await redisClient.ttl(key);
        return { count: Number(raw) || 0, ttl: ttl > 0 ? ttl : LOGIN_WINDOW_SECONDS };
      }
      // Fall through: a count may exist in memory from while Redis was down.
    } catch {
      // use memory
    }
  }
  const now = Date.now();
  const entry = memoryGet(key, now);
  if (!entry) return { count: 0, ttl: 0 };
  return { count: entry.count, ttl: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

async function incrementCounter(key: string): Promise<void> {
  if (redisClient.isOpen) {
    try {
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.expire(key, LOGIN_WINDOW_SECONDS);
      return;
    } catch {
      // use memory
    }
  }
  const now = Date.now();
  sweepMemory(now);
  const entry = memoryGet(key, now);
  if (entry) entry.count += 1;
  else memory.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_SECONDS * 1000 });
}

async function deleteCounter(key: string): Promise<void> {
  memory.delete(key);
  if (redisClient.isOpen) {
    try {
      await redisClient.del(key);
    } catch {
      // memory entry already removed
    }
  }
}

export interface LoginGate {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Is this IP/email currently allowed to attempt a login? */
export async function checkLoginAllowed(ip: string, email: string): Promise<LoginGate> {
  const k = keys(ip, email);
  let retryAfterSeconds = 0;
  for (const { key, limit } of [k.ipEmail, k.ip, k.email]) {
    const { count, ttl } = await readCounter(key);
    if (count >= limit) retryAfterSeconds = Math.max(retryAfterSeconds, ttl || LOGIN_WINDOW_SECONDS);
  }
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
}

export async function recordLoginFailure(ip: string, email: string): Promise<void> {
  const k = keys(ip, email);
  await incrementCounter(k.ipEmail.key);
  await incrementCounter(k.ip.key);
  await incrementCounter(k.email.key);
}

/**
 * After a successful login: clear the account-level counters. The per-IP
 * counter is left to expire so a valid account cannot be used to reset it.
 */
export async function clearLoginFailures(ip: string, email: string): Promise<void> {
  const k = keys(ip, email);
  await deleteCounter(k.ipEmail.key);
  await deleteCounter(k.email.key);
}

/** Test helper: forget all in-memory counters. */
export function resetLoginLimiterMemory(): void {
  memory.clear();
}

/**
 * Test helper: pretend the 15-minute window has passed. Expires every in-memory
 * counter and, when Redis is connected, removes the Redis counters too (a real
 * expiry would remove them), so the helper behaves the same with or without Redis.
 */
export async function expireLoginLimiterMemory(): Promise<void> {
  for (const entry of memory.values()) entry.resetAt = 0;
  if (redisClient.isOpen) {
    try {
      const stale = await redisClient.keys(`${PREFIX}*`);
      if (stale.length) await redisClient.del(stale);
    } catch {
      // Redis unavailable: nothing more to expire
    }
  }
}
