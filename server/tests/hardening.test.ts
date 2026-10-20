import "./helpers"; // must stay first: sets test-only env vars before the app loads
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import jwt from "jsonwebtoken";
import {
  pool,
  redisClient,
  hasRedis,
  applyMigrations,
  startTestServer,
  resetAndSeed,
  makeApi,
  createUserWithToken,
  createOrder,
  stockOf,
  cartLines,
  Fixtures,
} from "./helpers";
import { assertJwtConfig, signToken, verifyToken, getTokenMaxAgeMs } from "../src/utils/jwt";
import { hashPassword, getDummyHash, comparePassword } from "../src/utils/password";
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  resetLoginLimiterMemory,
  expireLoginLimiterMemory,
  LOGIN_WINDOW_SECONDS,
} from "../src/utils/loginRateLimiter";
import { errorHandler, AppError } from "../src/middleware/errorHandler";

let server: Awaited<ReturnType<typeof startTestServer>>;
let call: ReturnType<typeof makeApi>;
let fx: Fixtures;
let admin: { id: string; email: string; token: string };

before(async () => {
  await applyMigrations();
  server = await startTestServer();
  call = makeApi(server.baseUrl);
});
after(async () => {
  await server.close();
});
beforeEach(async () => {
  fx = await resetAndSeed();
  admin = await createUserWithToken("Admin One", "admin");
  resetLoginLimiterMemory();
  if (hasRedis) {
    // Failure counters live in Redis too; start every test from zero.
    const stale = await redisClient.keys("login:fail:*");
    if (stale.length) await redisClient.del(stale);
  }
});

// ---------------------------------------------------------------- helpers
/** Plain fetch without any auth header (the shared `call` always sends a bearer token). */
async function raw(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as any, headers: res.headers };
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const PASSWORD = "Passw0rd1";
async function createLoginUser(name: string) {
  const email = `${name.toLowerCase().replace(/\s/g, "")}@login.test`;
  const hash = await hashPassword(PASSWORD);
  const r = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer') RETURNING id",
    [name, email, hash]
  );
  return { id: r.rows[0].id as string, email };
}
const login = (email: string, password: string) => raw("POST", "/auth/login", { email, password });

async function categoryId() {
  return (await pool.query("SELECT id FROM categories LIMIT 1")).rows[0].id as number;
}
async function bookExists(id: string) {
  return (await pool.query("SELECT 1 FROM books WHERE id = $1", [id])).rows.length === 1;
}
/** A book with no orders, carts or store listings (only legacy inventory), so it is deletable. */
async function createFreeBook(title = "Free Book") {
  const cat = await categoryId();
  const b = await pool.query(
    "INSERT INTO books (title, author, price, category_id) VALUES ($1, 'Someone', 100, $2) RETURNING id",
    [title, cat]
  );
  await pool.query("INSERT INTO inventory (book_id, quantity) VALUES ($1, 4)", [b.rows[0].id]);
  return b.rows[0].id as string;
}
const addToCart = (token: string, bookId: string, quantity: number, storeId?: string) =>
  call(token, "POST", "/cart", { bookId, quantity, storeId });

function fakeRes() {
  const r: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(b: any) {
      r.body = b;
      return r;
    },
  };
  return r;
}
async function captureConsoleError<T>(fn: () => T | Promise<T>) {
  const original = console.error;
  const calls: any[][] = [];
  console.error = (...args: any[]) => {
    calls.push(args);
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return calls;
}

// ---------------------------------------------------------------- auth: JWT config & tokens
describe("JWT configuration", () => {
  it("refuses a missing JWT_SECRET outside tests, without echoing any secret", async () => {
    await withEnv({ NODE_ENV: "production", JWT_SECRET: undefined }, () => {
      assert.throws(() => assertJwtConfig(), /JWT_SECRET is not set/);
      assert.throws(() => signToken({ userId: fx.customer1.id, email: "a@b.co", role: "customer" }));
    });
  });

  it("refuses a short secret and a known placeholder, and the message never contains the secret", async () => {
    const short = "short-secret-123";
    await withEnv({ NODE_ENV: "production", JWT_SECRET: short }, () => {
      assert.throws(
        () => assertJwtConfig(),
        (err: Error) => /too short/.test(err.message) && !err.message.includes(short)
      );
    });
    await withEnv({ NODE_ENV: "production", JWT_SECRET: "replace_this_with_a_long_random_string" }, () => {
      assert.throws(() => assertJwtConfig(), /placeholder/);
    });
    await withEnv({ NODE_ENV: "production", JWT_SECRET: "x".repeat(40) }, () => {
      assert.doesNotThrow(() => assertJwtConfig());
    });
  });

  it("the server process exits with an error at startup when JWT_SECRET is too short", () => {
    const serverDir = path.join(__dirname, "..");
    const result = spawnSync(
      process.execPath,
      ["--require", "ts-node/register/transpile-only", "src/index.ts"],
      {
        cwd: serverDir,
        env: { ...process.env, NODE_ENV: "development", JWT_SECRET: "tiny-secret", PORT: "0" },
        encoding: "utf-8",
        timeout: 60000,
      }
    );
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /JWT_SECRET is too short/);
    assert.ok(!output.includes("tiny-secret"), "the secret must not be printed");
  });

  it("cookie lifetime follows JWT_EXPIRES_IN and defaults to 7 days", async () => {
    await withEnv({ JWT_EXPIRES_IN: undefined }, () => assert.equal(getTokenMaxAgeMs(), 7 * 24 * 3600 * 1000));
    await withEnv({ JWT_EXPIRES_IN: "12h" }, () => assert.equal(getTokenMaxAgeMs(), 12 * 3600 * 1000));
    await withEnv({ JWT_EXPIRES_IN: "30m" }, () => assert.equal(getTokenMaxAgeMs(), 30 * 60 * 1000));
    await withEnv({ JWT_EXPIRES_IN: "not-a-duration" }, () => assert.equal(getTokenMaxAgeMs(), 7 * 24 * 3600 * 1000));
  });
});

describe("token verification", () => {
  const secret = () => process.env.JWT_SECRET as string;
  const good = () => ({ userId: fx.customer1.id, email: "customer1@test.local", role: "customer" });

  it("accepts a normal token and returns exactly the payload fields", () => {
    const decoded = verifyToken(signToken(good() as any));
    assert.deepEqual(decoded, good());
  });

  it("rejects tokens signed with a different algorithm, or unsigned", () => {
    const hs512 = jwt.sign(good(), secret(), { algorithm: "HS512" });
    assert.throws(() => verifyToken(hs512));
    const unsigned = jwt.sign(good(), "", { algorithm: "none" } as any);
    assert.throws(() => verifyToken(unsigned));
  });

  it("rejects a wrong signature and malformed payloads", () => {
    assert.throws(() => verifyToken(jwt.sign(good(), "some-other-secret")));
    assert.throws(() => verifyToken(jwt.sign({ ...good(), role: "superuser" }, secret())));
    assert.throws(() => verifyToken(jwt.sign({ ...good(), userId: "not-a-uuid" }, secret())));
    assert.throws(() => verifyToken(jwt.sign({ email: "a@b.co", role: "admin" }, secret())));
    assert.throws(() => verifyToken("garbage"));
  });

  it("a garbage bearer token gets a clean 401", async () => {
    const res = await call("garbage.token.value", "GET", "/auth/me");
    assert.equal(res.status, 401);
    assert.equal(JSON.stringify(res.body).includes(secret()), false);
  });
});

describe("authenticated requests re-check the database", () => {
  it("a token for a deleted user is rejected", async () => {
    const ghost = await createUserWithToken("Ghost User", "customer");
    assert.equal((await call(ghost.token, "GET", "/auth/me")).status, 200);
    await pool.query("DELETE FROM users WHERE id = $1", [ghost.id]);
    const res = await call(ghost.token, "GET", "/auth/me");
    assert.equal(res.status, 401);
  });

  it("a demoted admin loses access immediately even though the token still says admin", async () => {
    assert.equal((await call(admin.token, "GET", "/admin/dashboard")).status, 200);
    await pool.query("UPDATE users SET role = 'customer' WHERE id = $1", [admin.id]);
    const res = await call(admin.token, "GET", "/admin/dashboard");
    assert.equal(res.status, 403);
  });

  it("a promoted user gets the new role without a new token", async () => {
    const user = await createUserWithToken("Rising Star", "customer");
    assert.equal((await call(user.token, "GET", "/admin/dashboard")).status, 403);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
    assert.equal((await call(user.token, "GET", "/admin/dashboard")).status, 200);
  });
});

// ---------------------------------------------------------------- login rate limiting
describe("login", () => {
  it("a successful login returns a user, a token and an httpOnly cookie that lasts as long as the token", async () => {
    const u = await createLoginUser("Reader One");
    const res = await login(u.email, PASSWORD);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, u.email);
    assert.ok(res.body.token);
    const cookie = res.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Max-Age=604800/);
  });

  it("unknown email and wrong password give the same 401 message", async () => {
    const u = await createLoginUser("Reader Two");
    const wrongPw = await login(u.email, "WrongPass1");
    const unknown = await login("nobody@login.test", "WrongPass1");
    assert.equal(wrongPw.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrongPw.body.error, unknown.body.error);
  });

  it("unknown emails run a real bcrypt comparison against a dummy hash", async () => {
    const dummy = await getDummyHash();
    assert.match(dummy, /^\$2[aby]\$10\$/);
    assert.equal(await comparePassword(PASSWORD, dummy), false);
    assert.equal(await getDummyHash(), dummy, "computed once and reused");
  });
});

describe("login rate limiting", () => {
  it("blocks after 5 failed attempts for the same IP+email, even for the right password, then expires", async () => {
    const u = await createLoginUser("Reader Three");
    for (let i = 0; i < 5; i++) assert.equal((await login(u.email, "WrongPass1")).status, 401);

    const blocked = await login(u.email, PASSWORD);
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /Too many failed login attempts/);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= LOGIN_WINDOW_SECONDS, `Retry-After was ${retryAfter}`);

    // Not a permanent lockout: once the window has passed the right password works again.
    await expireLoginLimiterMemory();
    assert.equal((await login(u.email, PASSWORD)).status, 200);
  });

  it("is case-insensitive about the email (normalised)", async () => {
    const u = await createLoginUser("Reader Four");
    for (let i = 0; i < 5; i++) await login(i % 2 ? u.email.toUpperCase() : u.email, "WrongPass1");
    assert.equal((await login(u.email, PASSWORD)).status, 429);
  });

  it("one blocked account does not stop other accounts from the same IP", async () => {
    const a = await createLoginUser("Reader Five");
    const b = await createLoginUser("Reader Six");
    for (let i = 0; i < 5; i++) await login(a.email, "WrongPass1");
    assert.equal((await login(a.email, PASSWORD)).status, 429);
    assert.equal((await login(b.email, PASSWORD)).status, 200);
  });

  it("a successful login clears the failure count", async () => {
    const u = await createLoginUser("Reader Seven");
    for (let i = 0; i < 4; i++) await login(u.email, "WrongPass1");
    assert.equal((await login(u.email, PASSWORD)).status, 200);
    // 4 more failures would have been 8 without the reset; the 5th failure is what blocks.
    for (let i = 0; i < 4; i++) assert.equal((await login(u.email, "WrongPass1")).status, 401);
    assert.equal((await login(u.email, PASSWORD)).status, 200);
  });

  it("unknown emails are counted too, so guessing cannot be done for free", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login("ghost@login.test", "WrongPass1")).status, 401);
    assert.equal((await login("ghost@login.test", "WrongPass1")).status, 429);
  });

  it("limits one IP spraying many different emails", async () => {
    const real = await createLoginUser("Reader Eight");
    for (let i = 0; i < 20; i++) await login(`spray${i}@login.test`, "WrongPass1");
    const res = await login(real.email, PASSWORD);
    assert.equal(res.status, 429);
    await expireLoginLimiterMemory();
    assert.equal((await login(real.email, PASSWORD)).status, 200);
  });

  it("someone failing from another IP cannot lock the real owner out", async () => {
    for (let i = 0; i < 5; i++) await recordLoginFailure("10.0.0.1", "victim@login.test");
    assert.equal((await checkLoginAllowed("10.0.0.1", "victim@login.test")).allowed, false);
    assert.equal((await checkLoginAllowed("192.168.1.9", "victim@login.test")).allowed, true);
  });

  it("a very large distributed guessing run against one email is still stopped (email-wide backstop)", async () => {
    for (let i = 0; i < 50; i++) await recordLoginFailure(`10.1.${Math.floor(i / 200)}.${i % 200}`, "target@login.test");
    assert.equal((await checkLoginAllowed("203.0.113.5", "target@login.test")).allowed, false);
    assert.equal((await checkLoginAllowed("203.0.113.5", "someoneelse@login.test")).allowed, true);
    await clearLoginFailures("203.0.113.5", "target@login.test");
    assert.equal((await checkLoginAllowed("203.0.113.5", "target@login.test")).allowed, true);
  });

  it("works from memory when Redis is unavailable (the default in this test run)", async () => {
    assert.equal(redisClient.isOpen, hasRedis);
    await recordLoginFailure("10.2.2.2", "mem@login.test");
    assert.equal((await checkLoginAllowed("10.2.2.2", "mem@login.test")).allowed, true);
  });

  it("uses Redis counters with an expiry when Redis is available", { skip: !hasRedis && "set TEST_REDIS_URL to run" }, async () => {
    const keys = await redisClient.keys("login:fail:*");
    if (keys.length) await redisClient.del(keys);
    for (let i = 0; i < 5; i++) await recordLoginFailure("10.3.3.3", "redis@login.test");
    const gate = await checkLoginAllowed("10.3.3.3", "redis@login.test");
    assert.equal(gate.allowed, false);
    const ttl = await redisClient.ttl("login:fail:ipemail:10.3.3.3|redis@login.test");
    assert.ok(ttl > 0 && ttl <= LOGIN_WINDOW_SECONDS, `ttl was ${ttl}`);
    await clearLoginFailures("10.3.3.3", "redis@login.test");
    assert.equal((await checkLoginAllowed("10.3.3.3", "redis@login.test")).allowed, true);
    const left = await redisClient.keys("login:fail:*");
    if (left.length) await redisClient.del(left);
  });
});

// ---------------------------------------------------------------- error handling
describe("error handling", () => {
  it("malformed JSON gets a 400 with no internals", async () => {
    const res = await raw("POST", "/books", "{ this is not json", { Authorization: `Bearer ${admin.token}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "The request body is not valid JSON.");
    assert.equal(JSON.stringify(res.body).includes("SyntaxError"), false);
  });

  it("maps database error codes to 4xx with fixed, client-safe messages", () => {
    const cases: [string, number][] = [
      ["23505", 409],
      ["23503", 409],
      ["23514", 422],
      ["22P02", 422],
      ["23502", 422],
      ["22003", 422],
    ];
    for (const [code, status] of cases) {
      const res = fakeRes();
      const err: any = new Error('insert into "books" violates something (Key (isbn)=(123) ...)');
      err.code = code;
      err.detail = "secret table detail";
      errorHandler(err, {} as any, res, () => {});
      assert.equal(res.statusCode, status, `code ${code}`);
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes("books") && !text.includes("secret") && !text.includes("isbn"), `leaked for ${code}`);
    }
  });

  it("unknown errors become a generic 500 and AppError keeps its own status", () => {
    const res = fakeRes();
    const err: any = new Error("password=hunter2 at /srv/app/db.ts:12");
    errorHandler(err, {} as any, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "Internal server error." });

    const res2 = fakeRes();
    errorHandler(new AppError("Nope.", 418), {} as any, res2, () => {});
    assert.equal(res2.statusCode, 418);
    assert.deepEqual(res2.body, { error: "Nope." });
  });

  it("in production only name, code and a short message are logged, never the stack", async () => {
    const err: any = new Error("boom");
    err.code = "XX000";
    const calls = await withEnv({ NODE_ENV: "production" }, () =>
      captureConsoleError(() => errorHandler(err, {} as any, fakeRes(), () => {}))
    );
    assert.equal(calls.length, 1);
    const logged = JSON.stringify(calls[0].slice(1));
    assert.ok(!logged.includes("stack") && !logged.includes(" at "), logged);
    assert.ok(logged.includes("XX000"));
  });
});

// ---------------------------------------------------------------- book & category validation
describe("book validation", () => {
  const valid = async (over: Record<string, unknown> = {}) => ({
    title: "New Book",
    author: "New Author",
    price: 250,
    categoryId: await categoryId(),
    quantity: 3,
    ...over,
  });

  it("creates a book with a valid body and normalises the ISBN", async () => {
    const res = await call(admin.token, "POST", "/books", await valid({ isbn: "978-0-06-025492-6" }));
    assert.equal(res.status, 201);
    const row = (await pool.query("SELECT isbn FROM books WHERE id = $1", [res.body.id])).rows[0];
    assert.equal(row.isbn, "9780060254926");
    const stock = (await pool.query("SELECT quantity FROM inventory WHERE book_id = $1", [res.body.id])).rows[0];
    assert.equal(stock.quantity, 3);
  });

  it("rejects a bad or missing category with 422, not 500", async () => {
    assert.equal((await call(admin.token, "POST", "/books", await valid({ categoryId: "abc" }))).status, 422);
    assert.equal((await call(admin.token, "POST", "/books", await valid({ categoryId: 99999 }))).status, 422);
    assert.equal((await call(admin.token, "POST", "/books", await valid({ categoryId: undefined }))).status, 422);
    assert.equal((await call(admin.token, "POST", "/books", await valid({ categoryId: 1.5 }))).status, 422);
  });

  it("rejects negative, fractional and non-numeric quantities", async () => {
    for (const quantity of [-1, 1.5, "abc", true, {}]) {
      const res = await call(admin.token, "POST", "/books", await valid({ quantity }));
      assert.equal(res.status, 422, `quantity ${JSON.stringify(quantity)}`);
    }
  });

  it("rejects malformed ISBNs and reports duplicates as 409", async () => {
    for (const isbn of ["abc", "12345", "97800602549260", 12345]) {
      const res = await call(admin.token, "POST", "/books", await valid({ isbn }));
      assert.equal(res.status, 422, `isbn ${JSON.stringify(isbn)}`);
    }
    assert.equal((await call(admin.token, "POST", "/books", await valid({ isbn: "9781234567897" }))).status, 201);
    const dup = await call(admin.token, "POST", "/books", await valid({ isbn: "978-1-234-56789-7" }));
    assert.equal(dup.status, 409);
  });

  it("no book was created by any rejected request", async () => {
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM books")).rows[0].n;
    await call(admin.token, "POST", "/books", await valid({ quantity: -5 }));
    await call(admin.token, "POST", "/books", await valid({ categoryId: 99999 }));
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM books")).rows[0].n, before);
  });

  it("update validates the same way", async () => {
    assert.equal(
      (await call(admin.token, "PUT", `/books/${fx.book2Id}`, await valid({ categoryId: "x" }))).status,
      422
    );
    assert.equal((await call(admin.token, "PUT", `/books/${fx.book2Id}`, await valid({ isbn: "bad" }))).status, 422);
    assert.equal((await call(admin.token, "PUT", `/books/${fx.book2Id}`, await valid({ quantity: -2 }))).status, 422);
    assert.equal((await call(admin.token, "PUT", `/books/${fx.book2Id}`, await valid({ quantity: 9 }))).status, 200);
  });
});

describe("categories use integer IDs", () => {
  it("create, update and delete work with numeric ids", async () => {
    const created = await call(admin.token, "POST", "/categories", { name: "Poetry" });
    assert.equal(created.status, 201);
    const id = created.body.category.id;
    assert.equal(typeof id, "number");

    const updated = await call(admin.token, "PUT", `/categories/${id}`, { name: "Modern Poetry" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.category.name, "Modern Poetry");

    assert.equal((await call(admin.token, "DELETE", `/categories/${id}`)).status, 204);
    assert.equal((await call(admin.token, "DELETE", `/categories/${id}`)).status, 404);
  });

  it("rejects non-integer ids with 400 and refuses to delete a category that has books", async () => {
    assert.equal((await call(admin.token, "PUT", "/categories/abc", { name: "Whatever" })).status, 400);
    assert.equal((await call(admin.token, "PUT", "/categories/1.5", { name: "Whatever" })).status, 400);
    assert.equal(
      (await call(admin.token, "PUT", "/categories/6f1d3b1e-1c11-4a8e-9b0a-0d8f5d3f7c11", { name: "Whatever" })).status,
      400
    );
    assert.equal((await call(admin.token, "DELETE", `/categories/${await categoryId()}`)).status, 409);
  });
});

// ---------------------------------------------------------------- deletion safety
describe("book deletion safety", () => {
  it("blocks deletion when an order references the book and preserves everything", async () => {
    await createOrder(fx.customer1.id, [{ bookId: fx.book2Id, storeId: null, quantity: 1, unitPrice: 300 }]);
    const res = await call(admin.token, "DELETE", `/books/${fx.book2Id}`);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /existing orders/);
    assert.ok(await bookExists(fx.book2Id));
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM order_items WHERE book_id = $1", [fx.book2Id])).rows[0].n, 1);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0].n, 1);
  });

  it("blocks deletion when a customer's cart holds the book, leaving the reservation intact", async () => {
    assert.equal((await addToCart(fx.customer1.token, fx.book2Id, 2)).status, 200);
    const res = await call(admin.token, "DELETE", `/books/${fx.book2Id}`);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /customer carts/);
    assert.ok(await bookExists(fx.book2Id));
    assert.equal((await cartLines(fx.customer1.id)).length, 1);
    assert.equal((await pool.query("SELECT reserved FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0].reserved, 2);
  });

  it("blocks deletion when a store lists the book and keeps the listings and legacy stock", async () => {
    const res = await call(admin.token, "DELETE", `/books/${fx.bookId}`);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /store listings/);
    assert.ok(await bookExists(fx.bookId));
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM store_book_inventory WHERE book_id = $1", [fx.bookId])).rows[0].n, 2);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM inventory WHERE book_id = $1", [fx.bookId])).rows[0].n, 1);
  });

  it("names every kind of reference at once", async () => {
    await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }]);
    await addToCart(fx.customer2.token, fx.bookId, 1);
    const res = await call(admin.token, "DELETE", `/books/${fx.bookId}`);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /existing orders, customer carts, store listings/);
  });

  it("still deletes a book that nothing references (with its legacy stock row)", async () => {
    const id = await createFreeBook();
    assert.equal((await call(admin.token, "DELETE", `/books/${id}`)).status, 204);
    assert.equal(await bookExists(id), false);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM inventory WHERE book_id = $1", [id])).rows[0].n, 0);
  });

  it("returns 404 for an unknown book and 400 for a malformed id", async () => {
    assert.equal((await call(admin.token, "DELETE", "/books/6f1d3b1e-1c11-4a8e-9b0a-0d8f5d3f7c11")).status, 404);
    assert.equal((await call(admin.token, "DELETE", "/books/not-a-uuid")).status, 400);
  });

  it("deleting while a customer adds the book to a cart never leaves a half-state", async () => {
    for (let i = 0; i < 6; i++) {
      const id = await createFreeBook(`Race Book ${i}`);
      const [del, add] = await Promise.all([
        call(admin.token, "DELETE", `/books/${id}`),
        addToCart(fx.customer1.token, id, 1),
      ]);
      const exists = await bookExists(id);
      const inCart = (await cartLines(fx.customer1.id)).some((l) => l.book_id === id);
      if (del.status === 204) {
        assert.equal(exists, false, "deleted");
        assert.equal(inCart, false, "no orphaned cart line");
        assert.notEqual(add.status, 200, "the add must not have succeeded");
      } else {
        assert.equal(del.status, 409, `delete status ${del.status}`);
        assert.ok(exists, "book kept");
        assert.equal(add.status, 200);
        assert.ok(inCart, "cart line kept");
      }
      await call(fx.customer1.token, "DELETE", "/cart"); // reset for the next round
    }
  });
});

// ---------------------------------------------------------------- inventory vs reserved
describe("stock can't be set below what is reserved", () => {
  it("admin inventory endpoint refuses it with 422 and changes nothing", async () => {
    await addToCart(fx.customer1.token, fx.book2Id, 3);
    const refused = await call(admin.token, "PATCH", `/books/${fx.book2Id}/inventory`, { quantity: 2 });
    assert.equal(refused.status, 422);
    assert.match(refused.body.error, /reserved/);
    assert.equal((await pool.query("SELECT quantity FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0].quantity, 5);

    const ok = await call(admin.token, "PATCH", `/books/${fx.book2Id}/inventory`, { quantity: 3 });
    assert.equal(ok.status, 200);
    assert.equal((await pool.query("SELECT quantity FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0].quantity, 3);
  });

  it("admin inventory endpoint validates the quantity", async () => {
    for (const quantity of [-1, 1.5, "x", null, undefined]) {
      const res = await call(admin.token, "PATCH", `/books/${fx.book2Id}/inventory`, { quantity });
      assert.equal(res.status, 422, `quantity ${JSON.stringify(quantity)}`);
    }
    assert.equal((await call(admin.token, "PATCH", `/books/${await createFreeBook()}/inventory`, { quantity: 0 })).status, 200);
  });

  it("editing a book with too-low stock rolls the whole edit back", async () => {
    await addToCart(fx.customer1.token, fx.book2Id, 3);
    const res = await call(admin.token, "PUT", `/books/${fx.book2Id}`, {
      title: "Renamed",
      author: "Author",
      price: 111,
      categoryId: await categoryId(),
      quantity: 1,
    });
    assert.equal(res.status, 422);
    const row = (await pool.query("SELECT title, price FROM books WHERE id = $1", [fx.book2Id])).rows[0];
    assert.equal(row.title, "Book Y");
    assert.equal(Number(row.price), 300);
  });

  it("store owner can't go below reserved, but equal is allowed and unsent fields are kept", async () => {
    await addToCart(fx.customer1.token, fx.bookId, 2, fx.storeA);
    const refused = await call(fx.ownerA.token, "PATCH", `/stores/inventory/${fx.bookId}`, { quantity: 1 });
    assert.equal(refused.status, 422);
    assert.match(refused.body.error, /reserved/);

    const ok = await call(fx.ownerA.token, "PATCH", `/stores/inventory/${fx.bookId}`, { quantity: 2 });
    assert.equal(ok.status, 200);
    const row = (await stockOf(fx.bookId, fx.storeA, fx.storeB)).a;
    assert.equal(row.quantity, 2);
    assert.equal(Number(row.price), 318, "price untouched by a quantity-only update");
  });

  it("store owner updates validate their inputs", async () => {
    const patch = (body: unknown) => call(fx.ownerA.token, "PATCH", `/stores/inventory/${fx.bookId}`, body);
    assert.equal((await patch({ quantity: "abc" })).status, 422);
    assert.equal((await patch({ quantity: -1 })).status, 422);
    assert.equal((await patch({ quantity: 1.5 })).status, 422);
    assert.equal((await patch({ price: -5 })).status, 422);
    assert.equal((await patch({ price: "free" })).status, 422);
    assert.equal((await patch({ isActive: "yes" })).status, 422);
    assert.equal((await patch({ isActive: false })).status, 200);
  });

  it("concurrent cart reservations and admin quantity cuts never leave quantity < reserved (legacy)", async () => {
    for (let i = 0; i < 10; i++) {
      fx = await resetAndSeed();
      admin = await createUserWithToken("Admin One", "admin");
      const [add, cut] = await Promise.all([
        addToCart(fx.customer1.token, fx.book2Id, 5),
        call(admin.token, "PATCH", `/books/${fx.book2Id}/inventory`, { quantity: 2 }),
      ]);
      const row = (await pool.query("SELECT quantity, reserved FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0];
      assert.ok(row.quantity >= row.reserved, `round ${i}: quantity ${row.quantity} < reserved ${row.reserved}`);
      assert.ok(!(add.status === 200 && cut.status === 200), `round ${i}: both succeeded`);
      assert.ok([200, 409].includes(add.status) && [200, 422].includes(cut.status), `${add.status}/${cut.status}`);
    }
  });

  it("concurrent cart reservations and store-owner quantity cuts never leave quantity < reserved (store)", async () => {
    for (let i = 0; i < 10; i++) {
      fx = await resetAndSeed();
      const [add, cut] = await Promise.all([
        addToCart(fx.customer1.token, fx.bookId, 3, fx.storeA),
        call(fx.ownerA.token, "PATCH", `/stores/inventory/${fx.bookId}`, { quantity: 1 }),
      ]);
      const row = (await stockOf(fx.bookId, fx.storeA, fx.storeB)).a;
      assert.ok(row.quantity >= row.reserved, `round ${i}: quantity ${row.quantity} < reserved ${row.reserved}`);
      assert.ok(!(add.status === 200 && cut.status === 200), `round ${i}: both succeeded`);
    }
  });

  it("many parallel quantity edits against many reservations keep the invariant", async () => {
    const jobs: Promise<unknown>[] = [];
    for (let q = 0; q < 6; q++) jobs.push(call(fx.ownerA.token, "PATCH", `/stores/inventory/${fx.bookId}`, { quantity: q }));
    jobs.push(addToCart(fx.customer1.token, fx.bookId, 1, fx.storeA));
    jobs.push(addToCart(fx.customer2.token, fx.bookId, 1, fx.storeA));
    await Promise.all(jobs);
    const row = (await stockOf(fx.bookId, fx.storeA, fx.storeB)).a;
    assert.ok(row.quantity >= row.reserved, `quantity ${row.quantity} < reserved ${row.reserved}`);
  });
});

describe("checkout with short legacy stock", () => {
  it("returns a clear 409 and changes nothing (no database 500)", async () => {
    await addToCart(fx.customer1.token, fx.book2Id, 2);
    // Simulate stock that was cut below the hold by data edited before the guard existed.
    await pool.query("UPDATE inventory SET quantity = 1 WHERE book_id = $1", [fx.book2Id]);

    const res = await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Only 1 copy of "Book Y" is in stock now/);

    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM orders")).rows[0].n, 0);
    assert.equal((await cartLines(fx.customer1.id)).length, 1, "cart kept");
    const stock = (await pool.query("SELECT quantity, reserved FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0];
    assert.deepEqual({ q: stock.quantity, r: stock.reserved }, { q: 1, r: 2 });
  });

  it("normal legacy checkout still works and deducts stock", async () => {
    await addToCart(fx.customer1.token, fx.book2Id, 2);
    const res = await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" });
    assert.equal(res.status, 201);
    const stock = (await pool.query("SELECT quantity, reserved FROM inventory WHERE book_id = $1", [fx.book2Id])).rows[0];
    assert.deepEqual({ q: stock.quantity, r: stock.reserved }, { q: 3, r: 0 });
  });
});

// ---------------------------------------------------------------- store activity
describe("inactive stores", () => {
  const deactivate = (storeId: string) => pool.query("UPDATE stores SET is_active = false WHERE id = $1", [storeId]);

  it("refuses to add a book from an inactive store", async () => {
    await deactivate(fx.storeA);
    const res = await addToCart(fx.customer1.token, fx.bookId, 1, fx.storeA);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /not currently accepting orders/);
    assert.equal((await cartLines(fx.customer1.id)).length, 0);
    assert.equal((await stockOf(fx.bookId, fx.storeA, fx.storeB)).a.reserved, 0);
  });

  it("blocks checkout of a line whose store went inactive, changing nothing", async () => {
    await addToCart(fx.customer1.token, fx.bookId, 2, fx.storeA);
    await deactivate(fx.storeA);

    const res = await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Store A is not currently accepting orders/);

    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM orders")).rows[0].n, 0);
    const a = (await stockOf(fx.bookId, fx.storeA, fx.storeB)).a;
    assert.deepEqual({ q: a.quantity, r: a.reserved }, { q: 3, r: 2 }, "stock and reservation untouched");
    assert.equal((await cartLines(fx.customer1.id)).length, 1, "cart kept");
  });

  it("cart view flags the line, '+' is refused, but '-' and remove still work", async () => {
    await addToCart(fx.customer1.token, fx.bookId, 2, fx.storeA);
    await deactivate(fx.storeA);

    const cart = await call(fx.customer1.token, "GET", "/cart");
    assert.equal(cart.body.items[0].storeActive, false);

    const inc = await call(fx.customer1.token, "PATCH", `/cart/${fx.bookId}`, { action: "increase" });
    assert.equal(inc.status, 409);

    const dec = await call(fx.customer1.token, "PATCH", `/cart/${fx.bookId}`, { action: "decrease" });
    assert.equal(dec.status, 200);
    assert.equal((await stockOf(fx.bookId, fx.storeA, fx.storeB)).a.reserved, 1);

    assert.equal((await call(fx.customer1.token, "DELETE", `/cart/${fx.bookId}`)).status, 200);
    assert.equal((await stockOf(fx.bookId, fx.storeA, fx.storeB)).a.reserved, 0);
  });

  it("a line from an inactive store can be moved to another source", async () => {
    await addToCart(fx.customer1.token, fx.bookId, 1, fx.storeA);
    await deactivate(fx.storeA);
    const toB = await addToCart(fx.customer1.token, fx.bookId, 1, fx.storeB);
    assert.equal(toB.status, 200);
    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 0);
    assert.equal(s.b.reserved, 2);
  });

  it("keeps order history and inventory records, and other stores keep selling", async () => {
    const orderId = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }]);
    await deactivate(fx.storeA);

    const orders = await call(fx.customer1.token, "GET", "/orders");
    assert.equal(orders.status, 200);
    assert.ok(orders.body.orders.some((o: any) => o.id === orderId));
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1", [orderId])).rows[0].n, 1);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM store_book_inventory WHERE store_id = $1", [fx.storeA])).rows[0].n, 1);

    assert.equal((await addToCart(fx.customer2.token, fx.bookId, 1, fx.storeB)).status, 200);
    const co = await call(fx.customer2.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" });
    assert.equal(co.status, 201);
  });

  it("an active store still works end to end", async () => {
    assert.equal((await addToCart(fx.customer1.token, fx.bookId, 1, fx.storeA)).status, 200);
    assert.equal((await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" })).status, 201);
  });
});

// ---------------------------------------------------------------- dashboard
describe("admin dashboard inventory figures", () => {
  it("reports catalog (legacy) and store inventory separately, using available stock", async () => {
    // Legacy: Book X plenty (50), Book Y low (5).  Store: A plenty (50), B low (3).
    await pool.query("UPDATE inventory SET quantity = 50 WHERE book_id = $1", [fx.bookId]);
    await pool.query("UPDATE store_book_inventory SET quantity = 50 WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId]);

    const res = await call(admin.token, "GET", "/admin/dashboard");
    assert.equal(res.status, 200);
    const d = res.body;

    assert.equal(d.legacyAvailableInventory, 55);
    assert.equal(d.storeAvailableInventory, 53);
    assert.deepEqual(d.lowStockBooks.map((b: any) => b.id), [fx.book2Id]);
    assert.equal(d.lowStockStoreListings.length, 1);
    assert.equal(d.lowStockStoreListings[0].storeId, fx.storeB);
    assert.equal(d.lowStockStoreListings[0].bookId, fx.bookId);
    assert.equal(d.lowStockStoreListings[0].availableQuantity, 3);
    assert.equal(d.availableInventory, undefined, "the old ambiguous combined field is gone");
  });

  it("subtracts reservations from both figures and from low-stock availability", async () => {
    await pool.query("UPDATE inventory SET quantity = 50 WHERE book_id = $1", [fx.bookId]);
    await addToCart(fx.customer1.token, fx.book2Id, 2); // legacy Book Y: 5 -> 3 available
    await addToCart(fx.customer1.token, fx.bookId, 2, fx.storeB); // store B: 3 -> 1 available

    const d = (await call(admin.token, "GET", "/admin/dashboard")).body;
    assert.equal(d.legacyAvailableInventory, 50 + 3);
    assert.equal(d.storeAvailableInventory, 3 + 1);
    const y = d.lowStockBooks.find((b: any) => b.id === fx.book2Id);
    assert.equal(y.availableQuantity, 3);
    const b = d.lowStockStoreListings.find((l: any) => l.storeId === fx.storeB);
    assert.equal(b.availableQuantity, 1);
  });

  it("a book with plenty of store stock is not reported low in the store list", async () => {
    await pool.query("UPDATE store_book_inventory SET quantity = 40", []);
    const d = (await call(admin.token, "GET", "/admin/dashboard")).body;
    assert.equal(d.lowStockStoreListings.length, 0);
    assert.equal(d.storeAvailableInventory, 80);
  });

  it("leaves inactive stores and inactive listings out of the store figures", async () => {
    await pool.query("UPDATE stores SET is_active = false WHERE id = $1", [fx.storeA]);
    await pool.query("UPDATE store_book_inventory SET is_active = false WHERE store_id = $1", [fx.storeB]);
    const d = (await call(admin.token, "GET", "/admin/dashboard")).body;
    assert.equal(d.storeAvailableInventory, 0);
    assert.equal(d.lowStockStoreListings.length, 0);
  });
});

// ---------------------------------------------------------------- pagination contract
describe("catalog pagination (what the admin pages and the store-owner picker rely on)", () => {
  it("caps a page at 50 but every book is reachable by walking the pages", async () => {
    const cat = await categoryId();
    await pool.query(
      `INSERT INTO books (title, author, isbn, price, category_id)
       SELECT 'Bulk Title ' || (g % 7), 'Bulk Author', '9781000' || lpad(g::text, 6, '0'), 100, $1
       FROM generate_series(1, 120) AS g`,
      [cat]
    );
    const total = (await pool.query("SELECT COUNT(*)::int AS n FROM books")).rows[0].n; // 122

    const capped = await raw("GET", "/books?limit=100&sort=title");
    assert.equal(capped.body.books.length, 50, "limit is capped at 50");
    assert.equal(capped.body.pagination.total, total);
    assert.equal(capped.body.pagination.totalPages, Math.ceil(total / 50));

    // Same loop the client's fetchAllBooks() uses.
    const ids: string[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await raw("GET", `/books?sort=title&limit=50&page=${page}`);
      ids.push(...res.body.books.map((b: any) => b.id));
      totalPages = res.body.pagination.totalPages;
      page += 1;
    } while (page <= totalPages);

    assert.equal(ids.length, total);
    assert.equal(new Set(ids).size, total, "no book repeated or skipped across pages, even with equal titles");
  });
});

// ---------------------------------------------------------------- cache invalidation
describe("cache invalidation", { skip: !hasRedis && "set TEST_REDIS_URL to run" }, () => {
  const prime = async (keys: string[]) => {
    for (const k of keys) await redisClient.set(k, "stale");
  };
  const present = async (keys: string[]) =>
    (await Promise.all(keys.map((k) => redisClient.exists(k)))).reduce((a, b) => a + b, 0);

  it("deleting a book clears its list, detail and store-listings caches", async () => {
    const id = await createFreeBook("Cached Book");
    const keys = ["books:list:test", `book:detail:${id}`, `book:store-listings:${id}`];
    await prime(keys);
    assert.equal((await call(admin.token, "DELETE", `/books/${id}`)).status, 204);
    assert.equal(await present(keys), 0);
  });

  it("a refused deletion leaves the caches alone", async () => {
    const keys = [`book:store-listings:${fx.bookId}`];
    await prime(keys);
    assert.equal((await call(admin.token, "DELETE", `/books/${fx.bookId}`)).status, 409);
    assert.equal(await present(keys), 1);
    await redisClient.del(keys);
  });

  it("updating a store clears every store-listings cache", async () => {
    const keys = [`book:store-listings:${fx.bookId}`, `book:store-listings:${fx.book2Id}`];
    await prime(keys);
    const res = await call(fx.ownerA.token, "PUT", "/stores", {
      name: "Store A Renamed",
      slug: "store-a",
      email: "a@store.test",
      address: "1 Main Street",
      city: "Chennai",
      state: "TN",
      postalCode: "600001",
      country: "IN",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await present(keys), 0);
  });
});
