import { redisClient } from "../config/redis";

const DEFAULT_TTL_SECONDS = 60;

/**
 * Small Redis cache helper. Every function fails silently (logs and
 * returns null/void) if Redis is down or errors, so PostgreSQL always
 * remains the source of truth and the app keeps working without cache.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    if (!redisClient.isOpen) return null;
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.error(`Redis GET failed for ${key}:`, (err as Error).message);
    return null;
  }
}

export async function setCache(key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  try {
    if (!redisClient.isOpen) return;
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    console.error(`Redis SET failed for ${key}:`, (err as Error).message);
  }
}

export async function deleteCacheByPrefix(prefix: string): Promise<void> {
  try {
    if (!redisClient.isOpen) return;
    const keys = await redisClient.keys(`${prefix}*`);
    if (keys.length > 0) await redisClient.del(keys);
  } catch (err) {
    console.error(`Redis DEL failed for prefix ${prefix}:`, (err as Error).message);
  }
}

export async function invalidateBookCaches(bookId?: string): Promise<void> {
  await deleteCacheByPrefix("books:list:");
  if (bookId) {
    await deleteCacheByPrefix(`book:detail:${bookId}`);
  } else {
    await deleteCacheByPrefix("book:detail:");
  }
}

export async function invalidateCategoryCaches(): Promise<void> {
  await deleteCacheByPrefix("categories:list");
  await invalidateBookCaches();
}