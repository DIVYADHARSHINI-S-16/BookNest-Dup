import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

export const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    // Give up quickly instead of hanging forever if Redis is unreachable.
    connectTimeout: 2000,
    // Stop retrying after 3 attempts so a dead Redis can't flood logs
    // or hold requests forever; the app just runs without a cache.
    reconnectStrategy: (retries) => {
      if (retries > 3) return new Error("Redis unavailable, giving up reconnects.");
      return Math.min(retries * 200, 1000);
    },
  },
  // Don't queue commands while disconnected — fail fast so getCache/
  // setCache return immediately instead of hanging, and PostgreSQL
  // stays the source of truth.
  disableOfflineQueue: true,
});

let loggedRedisError = false;
redisClient.on("error", (err) => {
  if (!loggedRedisError) {
    console.error("Redis Client Error:", err.message);
    loggedRedisError = true;
  }
});
redisClient.on("ready", () => {
  loggedRedisError = false; // reset once it reconnects successfully
});

export async function connectRedis(): Promise<void> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Redis connected");
  }
}