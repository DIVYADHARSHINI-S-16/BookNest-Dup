import "./helpers"; // must stay first: sets test-only env vars before the app loads
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express from "express";
import {
  redisClient,
  hasRedis,
  applyMigrations,
  startTestServer,
  resetAndSeed,
  Fixtures,
} from "./helpers";
import { clientKeyFromIp } from "../src/utils/clientIp";
import {
  discoveryRateLimiter,
  getDiscoveryRateLimitConfig,
  resetDiscoveryRateLimiter,
  DEFAULT_DISCOVERY_MAX,
  DEFAULT_DISCOVERY_WINDOW_SECONDS,
} from "../src/middleware/rateLimit";

let server: Awaited<ReturnType<typeof startTestServer>>;
let fx: Fixtures;

before(async () => {
  await applyMigrations();
  server = await startTestServer();
});
after(async () => {
  await server.close();
});
beforeEach(async () => {
  fx = await resetAndSeed();
  setLimit(3, 60);
  await resetDiscoveryRateLimiter();
});

function setLimit(max: number, windowSeconds: number) {
  process.env.DISCOVERY_RATE_LIMIT_MAX = String(max);
  process.env.DISCOVERY_RATE_LIMIT_WINDOW_SECONDS = String(windowSeconds);
}

async function send(method: string, url: string, opts: { body?: unknown; headers?: Record<string, string>; token?: string } = {}) {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as any, headers: res.headers };
}
const nearby = (body: unknown = {}, headers?: Record<string, string>) => send("POST", "/stores/nearby", { body, headers });
const storeBooks = (id: string) => send("GET", `/stores/${id}/books`);

const ORIGIN = { latitude: 13.0827, longitude: 80.2707 };

describe("clientKeyFromIp", () => {
  it("keeps IPv4 and unwraps IPv4-mapped IPv6", () => {
    assert.equal(clientKeyFromIp("203.0.113.7"), "203.0.113.7");
    assert.equal(clientKeyFromIp("::ffff:203.0.113.7"), "203.0.113.7");
  });
  it("counts IPv6 per /64, whatever the notation", () => {
    assert.equal(clientKeyFromIp("2001:db8:1:2:aaaa::1"), clientKeyFromIp("2001:0db8:0001:0002:0:0:0:ffff"));
    assert.notEqual(clientKeyFromIp("2001:db8:1:2::1"), clientKeyFromIp("2001:db8:1:3::1"));
    assert.equal(clientKeyFromIp("2001:db8::1"), "v6:2001:0db8:0000:0000/64");
    assert.equal(clientKeyFromIp("fe80::1%eth0"), "v6:fe80:0000:0000:0000/64");
  });
  it("never throws on odd input", () => {
    assert.equal(clientKeyFromIp(undefined), "unknown");
    assert.equal(clientKeyFromIp(null), "unknown");
    assert.equal(clientKeyFromIp("   "), "unknown");
    assert.equal(clientKeyFromIp("1::2::3"), "1::2::3");
    assert.equal(clientKeyFromIp("zz::1"), "zz::1");
  });
});

describe("getDiscoveryRateLimitConfig", () => {
  it("uses the documented defaults when nothing is set", () => {
    delete process.env.DISCOVERY_RATE_LIMIT_MAX;
    delete process.env.DISCOVERY_RATE_LIMIT_WINDOW_SECONDS;
    assert.deepEqual(getDiscoveryRateLimitConfig(), { max: DEFAULT_DISCOVERY_MAX, windowSeconds: DEFAULT_DISCOVERY_WINDOW_SECONDS });
    assert.deepEqual(getDiscoveryRateLimitConfig(), { max: 60, windowSeconds: 60 });
  });
  it("accepts valid overrides and falls back on invalid ones", () => {
    setLimit(10, 30);
    assert.deepEqual(getDiscoveryRateLimitConfig(), { max: 10, windowSeconds: 30 });
    for (const bad of ["0", "-1", "abc", "1.5", "100001", "", " "]) {
      process.env.DISCOVERY_RATE_LIMIT_MAX = bad;
      assert.equal(getDiscoveryRateLimitConfig().max, 60, `max=${JSON.stringify(bad)}`);
    }
    for (const bad of ["0", "3601", "x"]) {
      process.env.DISCOVERY_RATE_LIMIT_WINDOW_SECONDS = bad;
      assert.equal(getDiscoveryRateLimitConfig().windowSeconds, 60, `window=${JSON.stringify(bad)}`);
    }
  });
});

describe("public discovery endpoints are rate limited", () => {
  it("POST /stores/nearby: allows the limit, then answers 429 with a safe, consistent body", async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await nearby({ ...ORIGIN, radiusKm: 50 });
      assert.equal(ok.status, 200, `request ${i + 1}`);
      assert.equal(ok.headers.get("ratelimit-limit"), "3");
      assert.equal(ok.headers.get("ratelimit-remaining"), String(2 - i));
    }
    const blocked = await nearby({ ...ORIGIN, radiusKm: 50 });
    assert.equal(blocked.status, 429);
    assert.deepEqual(Object.keys(blocked.body).sort(), ["error", "retryAfterSeconds"]);
    assert.equal(typeof blocked.body.error, "string");
    assert.ok(Number.isInteger(blocked.body.retryAfterSeconds) && blocked.body.retryAfterSeconds >= 1 && blocked.body.retryAfterSeconds <= 60);
    assert.equal(blocked.headers.get("retry-after"), String(blocked.body.retryAfterSeconds));
    assert.equal(blocked.headers.get("ratelimit-remaining"), "0");
    assert.equal(blocked.headers.get("cache-control"), "no-store");
  });

  it("the 429 response never echoes the customer's coordinates or search text", async () => {
    for (let i = 0; i < 3; i++) await nearby({});
    const blocked = await nearby({ ...ORIGIN, query: "SecretSearchText" });
    assert.equal(blocked.status, 429);
    const text = JSON.stringify(blocked.body);
    assert.ok(!text.includes("13.08") && !text.includes("80.27") && !text.includes("SecretSearchText"));
  });

  it("GET /stores/:id/books is limited too, and shares one bucket with /nearby", async () => {
    await nearby({});
    await nearby({});
    assert.equal((await storeBooks(fx.storeA)).status, 200); // 3rd request of the window
    assert.equal((await storeBooks(fx.storeA)).status, 429);
    assert.equal((await nearby({})).status, 429);
  });

  it("invalid requests also count (the limiter runs before validation)", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await nearby({ latitude: 999, longitude: 0 })).status, 422);
    assert.equal((await nearby({})).status, 429);
  });

  it("a spoofed X-Forwarded-For header does not create a new allowance (trust proxy is off)", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await nearby({}, { "X-Forwarded-For": `198.51.100.${i + 1}` })).status, 200);
    assert.equal((await nearby({}, { "X-Forwarded-For": "203.0.113.99" })).status, 429);
    assert.equal((await nearby({}, { "X-Real-IP": "203.0.113.100", Forwarded: "for=203.0.113.101" })).status, 429);
  });

  it("allows requests again once the window has passed", async () => {
    for (let i = 0; i < 3; i++) await nearby({});
    assert.equal((await nearby({})).status, 429);
    await resetDiscoveryRateLimiter(); // same effect as the window ending
    assert.equal((await nearby({})).status, 200);
  });

  it("a short real window expires on its own", async () => {
    setLimit(1, 1);
    assert.equal((await nearby({})).status, 200);
    assert.equal((await nearby({})).status, 429);
    await new Promise((r) => setTimeout(r, 2100));
    assert.equal((await nearby({})).status, 200);
  });
});

describe("other routes are not affected by an exhausted discovery limit", () => {
  it("login, public catalogue, cart and store-owner routes keep working", async () => {
    for (let i = 0; i < 4; i++) await nearby({});
    assert.equal((await nearby({})).status, 429);

    const login = await send("POST", "/auth/login", { body: { email: "nobody@test.local", password: "wrong-password" } });
    assert.equal(login.status, 401); // normal failed-login answer, not 429

    assert.equal((await send("GET", "/books")).status, 200);
    assert.equal((await send("GET", "/cart", { token: fx.customer1.token })).status, 200);
    assert.equal((await send("GET", "/stores", { token: fx.ownerA.token })).status, 200);

    assert.equal((await send("GET", "/stores/orders", { token: fx.ownerA.token })).status, 200);
    assert.equal((await send("POST", "/stores/nearby", { token: fx.ownerA.token, body: {} })).status, 429, "the public route stays limited for owners too");
  });
});

describe("limiter behind a proxy (TRUST_PROXY configured)", () => {
  it("counts each forwarded client separately when the app trusts one proxy hop", async () => {
    setLimit(2, 60);
    await resetDiscoveryRateLimiter();
    const app = express();
    app.set("trust proxy", 1);
    app.get("/ping", discoveryRateLimiter, (_req, res) => res.json({ ok: true }));
    const srv = http.createServer(app);
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(srv.address() as any).port}`;
    const get = (xff: string) => fetch(`${base}/ping`, { headers: { "X-Forwarded-For": xff } }).then((r) => r.status);
    try {
      assert.equal(await get("198.51.100.1"), 200);
      assert.equal(await get("198.51.100.1"), 200);
      assert.equal(await get("198.51.100.1"), 429);
      assert.equal(await get("198.51.100.2"), 200); // a different real client has its own allowance
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });
});

describe("Redis-backed counters", { skip: !hasRedis }, () => {
  it("keeps the counter in Redis with an expiry and stores no location or request data", async () => {
    await nearby({ ...ORIGIN, query: "SecretSearchText" });
    const keys = await redisClient.keys("rl:discovery:*");
    assert.equal(keys.length, 1);
    assert.ok(!/13\.08|80\.27|SecretSearchText/.test(keys[0]));
    const ttl = await redisClient.ttl(keys[0]);
    assert.ok(ttl > 0 && ttl <= 60, `ttl ${ttl}`);
    assert.equal(await redisClient.get(keys[0]), "1");
  });

  it("repairs a counter that has lost its expiry", async () => {
    await nearby({});
    const [key] = await redisClient.keys("rl:discovery:*");
    await redisClient.persist(key);
    await nearby({});
    const ttl = await redisClient.ttl(key);
    assert.ok(ttl > 0 && ttl <= 60, `ttl ${ttl}`);
  });
});
