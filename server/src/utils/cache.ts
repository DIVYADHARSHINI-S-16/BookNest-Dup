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
    // Store listings are cached per book too; a deleted (or edited) book must
    // not keep serving a stale listings response for up to the TTL.
    await deleteCacheByPrefix(`book:store-listings:${bookId}`);
  } else {
    await deleteCacheByPrefix("book:detail:");
    await deleteCacheByPrefix("book:store-listings:");
  }
}

/**
 * Call after a store's public details change (name, city, state, ...).
 * Store-listings responses embed those fields for every book the store
 * stocks, so all of them are cleared.
 */
export async function invalidateStoreListingCaches(): Promise<void> {
  await deleteCacheByPrefix("book:store-listings:");
}

export async function invalidateCategoryCaches(): Promise<void> {
  await deleteCacheByPrefix("categories:list");
  await invalidateBookCaches();
}

/**
 * Call after any change to available stock (reservations, checkout, cancel).
 * Availability is shown in the books list, a book's detail page and the
 * store-listings dropdown, and all three are cached for up to 60s — so
 * clear them or customers would see stale "in stock" numbers.
 */
export async function invalidateAvailabilityCaches(bookIds: string[]): Promise<void> {
  const unique = Array.from(new Set(bookIds));
  if (unique.length === 0) return;
  await deleteCacheByPrefix("books:list:");
  for (const id of unique) {
    await deleteCacheByPrefix(`book:store-listings:${id}`);
    await deleteCacheByPrefix(`book:detail:${id}`);
  }
}
