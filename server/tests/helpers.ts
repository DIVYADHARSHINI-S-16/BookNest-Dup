/**
 * Shared setup for the integration tests.
 *
 * SAFETY: these tests TRUNCATE tables. They refuse to run unless
 * TEST_DATABASE_URL points at a database whose name contains "test", and they
 * never read DATABASE_URL, so your real BookNest database cannot be touched.
 */
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error(
    "Set TEST_DATABASE_URL to a throwaway PostgreSQL database (its name must contain 'test'), " +
      "e.g. postgres://postgres:postgres@localhost:5432/booknest_test"
  );
}
const dbName = decodeURIComponent(new URL(testDbUrl).pathname.replace(/^\//, ""));
if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run tests against database "${dbName}": its name must contain "test".`);
}

// Must be set BEFORE the app modules below are imported (they read env on load).
process.env.DATABASE_URL = testDbUrl;
process.env.NODE_ENV = "test"; // lets the short test-only JWT secret below pass the production-grade secret check
process.env.JWT_SECRET = "test-only-secret";
// The public discovery limiter (default 60/min) would throttle the many requests these suites make from
// one address. Effectively disable it here; rateLimit.test.ts lowers it explicitly per test.
process.env.DISCOVERY_RATE_LIMIT_MAX = "100000";
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:1"; // unreachable unless a test Redis is given

import fs from "fs";
import path from "path";
import http from "http";
import express from "express";
import { pool } from "../src/db/pool";
import { redisClient, connectRedis } from "../src/config/redis";
import { signToken } from "../src/utils/jwt";
import { errorHandler } from "../src/middleware/errorHandler";
import cookieParser from "cookie-parser";
import authRoutes from "../src/routes/authRoutes";
import bookRoutes from "../src/routes/bookRoutes";
import categoryRoutes from "../src/routes/categoryRoutes";
import adminRoutes from "../src/routes/adminRoutes";
import cartRoutes from "../src/routes/cartRoutes";
import orderRoutes from "../src/routes/orderRoutes";
import storeRoutes from "../src/routes/storeRoutes";
import bookRequestRoutes from "../src/routes/bookRequestRoutes";

export { pool, redisClient };
export const hasRedis = Boolean(process.env.TEST_REDIS_URL);

const MIGRATION_FILES = [
  "schema.sql",
  "migrations_phase1d.sql",
  "migrations_phase1e.sql",
  "migrations_phase1f.sql",
  "migrations_phase2a.sql",
  "migrations_phase2b.sql",
  "migrations_phase2c.sql",
  "migrations_phase3t5.sql",
  "migrations_phase3t2.sql",
  "migrations_phase3t7.sql",
];

export async function applyMigrations() {
  for (const file of MIGRATION_FILES) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/db", file), "utf-8");
    await pool.query(sql);
  }
}

export async function startTestServer() {
  if (hasRedis) await connectRedis();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.use("/api/books", bookRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/stores", storeRoutes);
  app.use("/api/book-requests", bookRequestRoutes);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      if (redisClient.isOpen) await redisClient.quit();
      await pool.end();
    },
  };
}

export interface Fixtures {
  customer1: { id: string; token: string };
  customer2: { id: string; token: string };
  ownerA: { id: string; token: string };
  ownerB: { id: string; token: string };
  storeA: string;
  storeB: string;
  bookId: string;
  book2Id: string;
}

/** Wipes every table and inserts a small, known data set. */
export async function resetAndSeed(): Promise<Fixtures> {
  await pool.query(
    `TRUNCATE book_request_responses, book_requests, order_items, orders, cart_items, cart, store_book_inventory, stores,
              inventory, second_hand_conditions, books, categories, users RESTART IDENTITY CASCADE`
  );

  const mkUser = async (name: string, role: string) => {
    const r = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email",
      [name, `${name.toLowerCase().replace(/\s/g, "")}@test.local`, role]
    );
    return { id: r.rows[0].id as string, email: r.rows[0].email as string, role };
  };
  const c1 = await mkUser("Customer One", "customer");
  const c2 = await mkUser("Customer Two", "customer");
  const ownerA = await mkUser("Owner A", "store_owner");
  const ownerB = await mkUser("Owner B", "store_owner");

  const cat = await pool.query("INSERT INTO categories (name, slug) VALUES ('Fiction', 'fiction') RETURNING id");
  const mkBook = async (title: string, isbn: string) =>
    (
      await pool.query(
        "INSERT INTO books (title, author, isbn, price, category_id) VALUES ($1, 'Author', $2, 300, $3) RETURNING id",
        [title, isbn, cat.rows[0].id]
      )
    ).rows[0].id as string;
  const bookId = await mkBook("Book X", "ISBN-X");
  const book2Id = await mkBook("Book Y", "ISBN-Y");

  const mkStore = async (name: string, ownerId: string) =>
    (
      await pool.query(
        "INSERT INTO stores (owner_user_id, name, slug, country) VALUES ($1, $2, $3, 'IN') RETURNING id",
        [ownerId, name, name.toLowerCase().replace(/\s/g, "-")]
      )
    ).rows[0].id as string;
  const storeA = await mkStore("Store A", ownerA.id);
  const storeB = await mkStore("Store B", ownerB.id);

  // Book X: legacy stock 5 @ ₹300 (books.price); Store A 3 @ ₹318; Store B 3 @ ₹350.
  await pool.query("INSERT INTO inventory (book_id, quantity) VALUES ($1, 5), ($2, 5)", [bookId, book2Id]);
  await pool.query(
    `INSERT INTO store_book_inventory (store_id, book_id, quantity, price) VALUES
       ($1, $3, 3, 318), ($2, $3, 3, 350)`,
    [storeA, storeB, bookId]
  );

  const tok = (u: { id: string; email: string; role: string }) =>
    signToken({ userId: u.id, email: u.email, role: u.role as any });
  return {
    customer1: { id: c1.id, token: tok(c1) },
    customer2: { id: c2.id, token: tok(c2) },
    ownerA: { id: ownerA.id, token: tok(ownerA) },
    ownerB: { id: ownerB.id, token: tok(ownerB) },
    storeA,
    storeB,
    bookId,
    book2Id,
  };
}

export function makeApi(baseUrl: string) {
  return async function call(token: string, method: string, url: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json as any };
  };
}

/** Reserved/quantity for each stock source of a book, read straight from the database. */
export async function stockOf(bookId: string, storeA: string, storeB: string) {
  const legacy = (await pool.query("SELECT quantity, reserved FROM inventory WHERE book_id = $1", [bookId])).rows[0];
  const store = async (id: string) =>
    (await pool.query("SELECT quantity, reserved, price FROM store_book_inventory WHERE store_id = $1 AND book_id = $2", [id, bookId])).rows[0];
  return { legacy, a: await store(storeA), b: await store(storeB) };
}

export async function cartLines(userId: string) {
  return (
    await pool.query(
      `SELECT ci.book_id, ci.quantity, ci.store_id, ci.store_price
       FROM cart_items ci JOIN cart c ON c.id = ci.cart_id WHERE c.user_id = $1 ORDER BY ci.book_id`,
      [userId]
    )
  ).rows;
}

/** Creates an extra user (any role) and returns their id, email and a valid login token. */
export async function createUserWithToken(name: string, role: "customer" | "admin" | "store_owner") {
  const email = `${name.toLowerCase().replace(/\s/g, "")}@test.local`;
  const r = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id",
    [name, email, role]
  );
  const id = r.rows[0].id as string;
  return { id, email, token: signToken({ userId: id, email, role }) };
}

export interface OrderLineSeed {
  bookId: string;
  /** null = legacy catalog line (order_items.store_id IS NULL) */
  storeId: string | null;
  quantity: number;
  unitPrice: number;
}

/** Inserts an order plus its lines directly (bypassing checkout) so tests control status, date and prices. */
export async function createOrder(
  userId: string,
  lines: OrderLineSeed[],
  opts: { status?: string; shippingAddress?: string; createdAt?: string } = {}
) {
  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const o = await pool.query(
    `INSERT INTO orders (user_id, status, subtotal, total, shipping_address, created_at)
     VALUES ($1, $2, $3, $3, $4, COALESCE($5::timestamptz, now())) RETURNING id`,
    [userId, opts.status ?? "PLACED", total.toFixed(2), opts.shippingAddress ?? "12 Test Street, Chennai 600001", opts.createdAt ?? null]
  );
  const orderId = o.rows[0].id as string;
  for (const l of lines) {
    await pool.query(
      "INSERT INTO order_items (order_id, book_id, quantity, unit_price, store_id) VALUES ($1, $2, $3, $4, $5)",
      [orderId, l.bookId, l.quantity, l.unitPrice, l.storeId]
    );
  }
  return orderId;
}
