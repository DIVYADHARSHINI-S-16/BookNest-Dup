import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { testConnection, pool } from "./db/pool";
import { connectRedis, redisClient } from "./config/redis";
import { assertJwtConfig } from "./utils/jwt";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/authRoutes";
import bookRoutes from "./routes/bookRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import cartRoutes from "./routes/cartRoutes";
import orderRoutes from "./routes/orderRoutes";
import adminRoutes from "./routes/adminRoutes";
import storeRoutes from "./routes/storeRoutes";
import bookRequestRoutes from "./routes/bookRequestRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Behind a reverse proxy/load balancer, set TRUST_PROXY (e.g. "1") so req.ip is
// the real client address; the login rate limiter keys on it. Left unset, the
// X-Forwarded-For header is ignored (it can be spoofed by clients).
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(tp) ? Number(tp) : tp === "true" ? true : tp === "false" ? false : tp);
}

app.use(helmet());
// CLIENT_ORIGIN may hold several comma-separated origins (e.g. production + preview).
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "booknest-server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/book-requests", bookRequestRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// In production, refuse to start with a config that would be unsafe or silently broken.
function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  const origin = process.env.CLIENT_ORIGIN;
  if (!origin) {
    problems.push("CLIENT_ORIGIN is not set (use your Vercel URL, e.g. https://your-app.vercel.app).");
  } else if (/localhost|127\.0\.0\.1/.test(origin)) {
    problems.push("CLIENT_ORIGIN still points at localhost.");
  }
  if (!process.env.TRUST_PROXY) {
    problems.push("TRUST_PROXY is not set (required behind Render/Vercel so rate limits see real client IPs).");
  }
  if (!process.env.REDIS_URL) {
    console.warn("REDIS_URL is not set: running without Redis (in-memory rate limits, no cache).");
  }
  if (problems.length) {
    console.error("Failed to start server (production config):\n - " + problems.join("\n - "));
    process.exit(1);
  }
}

async function start() {
  assertProductionConfig();
  // Refuse to start with a missing, short or placeholder JWT_SECRET.
  try {
    assertJwtConfig();
  } catch (err) {
    console.error("Failed to start server:", (err as Error).message);
    process.exit(1);
  }

  try {
    await testConnection();
  } catch (err) {
    console.error("Failed to start server (PostgreSQL required):", err);
    process.exit(1);
  }

  try {
    if (process.env.REDIS_URL || process.env.NODE_ENV !== "production") {
      await connectRedis();
    }
  } catch (err) {
    console.error("Redis unavailable, continuing without cache:", (err as Error).message);
  }

  const server = app.listen(PORT, () => {
    console.log(`BookNest server listening on port ${PORT}`);
  });

  // Render sends SIGTERM on deploy/restart: stop accepting requests, let in-flight
  // ones finish, then close PostgreSQL and Redis. Force-exit if that takes too long.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    server.close(async () => {
      try {
        await pool.end();
        if (redisClient.isOpen) await redisClient.quit();
      } catch (err) {
        console.error("Error during shutdown:", (err as Error).message);
      }
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
