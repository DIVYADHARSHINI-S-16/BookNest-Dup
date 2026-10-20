import "./helpers"; // must stay first: sets test-only env vars before the app loads
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  pool,
  redisClient,
  hasRedis,
  applyMigrations,
  startTestServer,
  resetAndSeed,
  makeApi,
  createUserWithToken,
  Fixtures,
} from "./helpers";
import {
  haversineKm,
  parseLatitude,
  parseLongitude,
  parseCoordinatePair,
  parseRadiusKm,
  latitudeBandDegrees,
  escapeLike,
  DEFAULT_RADIUS_KM,
} from "../src/utils/geo";

let server: Awaited<ReturnType<typeof startTestServer>>;
let call: ReturnType<typeof makeApi>;
let fx: Fixtures;

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
});

/** Public request: no Authorization header at all. */
async function publicCall(method: string, url: string, body?: unknown) {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as any, headers: res.headers };
}
const nearby = (body: unknown) => publicCall("POST", "/stores/nearby", body);

// Customer location used throughout: central Chennai.
const ORIGIN = { latitude: 13.0827, longitude: 80.2707 };

/** Gives a store coordinates `deltaLat` degrees north of ORIGIN (1 degree of latitude = 111.195 km). */
async function placeStore(storeId: string, deltaLat: number, extra: Record<string, unknown> = {}) {
  await pool.query(
    `UPDATE stores SET latitude = $2, longitude = $3, address = COALESCE($4, address), city = COALESCE($5, city),
            state = COALESCE($6, state), postal_code = COALESCE($7, postal_code) WHERE id = $1`,
    [
      storeId,
      ORIGIN.latitude + deltaLat,
      ORIGIN.longitude,
      (extra.address as string) ?? null,
      (extra.city as string) ?? null,
      (extra.state as string) ?? null,
      (extra.postal as string) ?? null,
    ]
  );
}

async function addExtraStore(name: string, opts: { lat?: number; lng?: number; active?: boolean; city?: string }) {
  const owner = await createUserWithToken(`Owner ${name}`, "store_owner");
  const r = await pool.query(
    `INSERT INTO stores (owner_user_id, name, slug, city, country, latitude, longitude, is_active, email, phone, address)
     VALUES ($1, $2, $3, $4, 'IN', $5, $6, $7, $8, '+91 99999 00000', '1 Test Road') RETURNING id`,
    [
      owner.id,
      name,
      name.toLowerCase().replace(/\s/g, "-"),
      opts.city ?? "Chennai",
      opts.lat ?? null,
      opts.lng ?? null,
      opts.active ?? true,
      `${name.toLowerCase().replace(/\s/g, "")}@private.test`,
    ]
  );
  return { id: r.rows[0].id as string, owner };
}

// ---------------------------------------------------------------------------
describe("coordinate validation (pure)", () => {
  it("accepts in-range values, including the exact limits", () => {
    for (const v of [0, 90, -90, 12.971599, "12.97", " -77.5 "]) assert.equal(parseLatitude(v).ok, true, String(v));
    for (const v of [0, 180, -180, 80.2707, "-179.999999"]) assert.equal(parseLongitude(v).ok, true, String(v));
  });

  it("rejects out-of-range latitude and longitude", () => {
    for (const v of [90.000001, -90.01, 91, 1000, "91"]) assert.equal(parseLatitude(v).ok, false, String(v));
    for (const v of [180.000001, -180.01, 181, 999, "181"]) assert.equal(parseLongitude(v).ok, false, String(v));
  });

  it("rejects non-numeric junk, NaN, Infinity, exponents, booleans, arrays and objects", () => {
    for (const v of ["abc", "NaN", "Infinity", "-Infinity", "1e2", "0x10", "12,5", NaN, Infinity, true, [], [1], {}, null, undefined]) {
      assert.equal(parseLatitude(v).ok, false, `lat ${String(v)}`);
      assert.equal(parseLongitude(v).ok, false, `lng ${String(v)}`);
    }
  });

  it("rounds to 6 decimal places", () => {
    const r = parseLatitude(12.123456789);
    assert.equal(r.ok && r.value, 12.123457);
  });

  it("a coordinate pair is both-or-neither", () => {
    assert.deepEqual(parseCoordinatePair(undefined, undefined), { ok: true, value: null });
    assert.deepEqual(parseCoordinatePair("", null), { ok: true, value: null });
    assert.equal(parseCoordinatePair(12.9, undefined).ok, false);
    assert.equal(parseCoordinatePair("", 77.5).ok, false);
    assert.equal(parseCoordinatePair(91, 77).ok, false);
    assert.equal(parseCoordinatePair(12, 181).ok, false);
    assert.deepEqual(parseCoordinatePair("12.5", "77.5"), { ok: true, value: { latitude: 12.5, longitude: 77.5 } });
  });

  it("radius: default, bounds and junk", () => {
    assert.deepEqual(parseRadiusKm(undefined), { ok: true, value: DEFAULT_RADIUS_KM });
    assert.deepEqual(parseRadiusKm(10), { ok: true, value: 10 });
    assert.deepEqual(parseRadiusKm("7.5"), { ok: true, value: 7.5 });
    for (const v of [0, 0.5, -1, 501, 1e9, "abc", "NaN", NaN, Infinity, true, [], {}, "5km"]) {
      assert.equal(parseRadiusKm(v).ok, false, String(v));
    }
  });

  it("escapeLike neutralises LIKE wildcards", () => {
    assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
  });
});

// ---------------------------------------------------------------------------
describe("distance calculation (pure)", () => {
  it("is zero for identical points", () => {
    assert.equal(haversineKm(ORIGIN, ORIGIN), 0);
  });

  it("matches known great-circle distances", () => {
    // One degree of longitude on the equator = 2*pi*R/360 = 111.195 km
    assert.ok(Math.abs(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111.195) < 0.01);
    // One degree of latitude anywhere
    assert.ok(Math.abs(haversineKm({ latitude: 40, longitude: 10 }, { latitude: 41, longitude: 10 }) - 111.195) < 0.01);
    // London -> Paris is about 343.5 km
    const lp = haversineKm({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 });
    assert.ok(Math.abs(lp - 343.5) < 1, `London-Paris ${lp}`);
    // Chennai -> Bengaluru is about 290 km in a straight line
    const cb = haversineKm(ORIGIN, { latitude: 12.9716, longitude: 77.5946 });
    assert.ok(cb > 280 && cb < 300, `Chennai-Bengaluru ${cb}`);
  });

  it("is symmetric, and correct across the antimeridian and the poles", () => {
    const a = { latitude: 13.08, longitude: 80.27 };
    const b = { latitude: 9.92, longitude: 78.12 };
    assert.equal(haversineKm(a, b), haversineKm(b, a));
    // 179.5E to 179.5W at the equator is 1 degree apart, not 359
    assert.ok(Math.abs(haversineKm({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 }) - 111.195) < 0.01);
    // Pole to pole = half the circumference
    assert.ok(Math.abs(haversineKm({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 }) - 20015.09) < 0.1);
    // Antipodal points must not produce NaN
    assert.ok(Number.isFinite(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })));
  });

  it("latitude band always contains every point within the radius", () => {
    for (const r of [1, 25, 500]) {
      const band = latitudeBandDegrees(r);
      const edge = haversineKm({ latitude: 10, longitude: 20 }, { latitude: 10 + band, longitude: 20 });
      assert.ok(edge >= r, `band for ${r} km is too narrow`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("POST /stores/nearby: sorting, radius, missing coordinates", () => {
  beforeEach(async () => {
    // Fixture stores: A ~5 km north, B ~20 km north. Extras below.
    await placeStore(fx.storeB, 0.18, { city: "Chennai" }); // inserted out of order on purpose
    await placeStore(fx.storeA, 0.045, { city: "Chennai" });
  });

  it("returns nearest-first with server-computed distances, default radius 25 km", async () => {
    const far = await addExtraStore("Far Store", { lat: ORIGIN.latitude + 0.54, lng: ORIGIN.longitude, city: "Madurai" }); // ~60 km
    assert.ok(far.id);
    const res = await nearby(ORIGIN);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.stores.map((s: any) => s.id), [fx.storeA, fx.storeB]);
    assert.equal(res.body.search.mode, "distance");
    assert.equal(res.body.search.radiusKm, DEFAULT_RADIUS_KM);

    const [a, b] = res.body.stores;
    assert.ok(Math.abs(a.distanceKm - 5.0) < 0.2, `A ${a.distanceKm}`);
    assert.ok(Math.abs(b.distanceKm - 20.0) < 0.2, `B ${b.distanceKm}`);
    assert.ok(a.distanceKm <= b.distanceKm);
  });

  it("SQL distance agrees with the JavaScript Haversine to within display rounding", async () => {
    const res = await nearby({ ...ORIGIN, radiusKm: 100 });
    const rows = await pool.query("SELECT id, latitude::float8 AS lat, longitude::float8 AS lng FROM stores");
    for (const s of res.body.stores) {
      const row = rows.rows.find((r: any) => r.id === s.id);
      const expected = haversineKm(ORIGIN, { latitude: row.lat, longitude: row.lng });
      assert.ok(Math.abs(s.distanceKm - expected) <= 0.06, `${s.name}: ${s.distanceKm} vs ${expected}`);
    }
  });

  it("known real-world distance: customer in London, store in Paris", async () => {
    await pool.query("UPDATE stores SET latitude = 48.8566, longitude = 2.3522 WHERE id = $1", [fx.storeA]);
    const res = await nearby({ latitude: 51.5074, longitude: -0.1278, radiusKm: 500 });
    const a = res.body.stores.find((s: any) => s.id === fx.storeA);
    assert.ok(a && Math.abs(a.distanceKm - 343.5) < 1, JSON.stringify(a));
  });

  it("radius filtering includes and excludes stores correctly", async () => {
    await addExtraStore("Far Store", { lat: ORIGIN.latitude + 0.54, lng: ORIGIN.longitude });
    const ids = async (radiusKm: number) => (await nearby({ ...ORIGIN, radiusKm })).body.stores.map((s: any) => s.id);
    assert.deepEqual(await ids(10), [fx.storeA]);
    assert.deepEqual(await ids(25), [fx.storeA, fx.storeB]);
    assert.equal((await ids(100)).length, 3);
    assert.deepEqual(await ids(4), [], "nothing within 4 km (A is ~5 km away)");
    // Boundary: just under / just over A's real distance
    const dA = haversineKm(ORIGIN, { latitude: ORIGIN.latitude + 0.045, longitude: ORIGIN.longitude });
    assert.deepEqual(await ids(Math.floor(dA * 100) / 100 - 0.01 < 1 ? 1 : dA - 0.01), []);
    assert.deepEqual(await ids(dA + 0.01), [fx.storeA]);
  });

  it("the exact distance test (not just the latitude band) decides inclusion for stores off to the side", async () => {
    // Same latitude as the customer, ~0.3 degrees of longitude east = ~32.5 km at 13 N.
    // It passes the latitude-band prefilter for any radius, so only the Haversine test can exclude it.
    const east = await addExtraStore("East Store", { lat: ORIGIN.latitude, lng: ORIGIN.longitude + 0.3 });
    const trueKm = haversineKm(ORIGIN, { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude + 0.3 });
    assert.ok(trueKm > 30 && trueKm < 35, String(trueKm));
    const within = async (radiusKm: number) =>
      (await nearby({ ...ORIGIN, radiusKm })).body.stores.some((s: any) => s.id === east.id);
    assert.equal(await within(25), false, "32 km away must not appear in a 25 km search");
    assert.equal(await within(Math.floor(trueKm)), false);
    assert.equal(await within(Math.ceil(trueKm) + 1), true);
    const res = await nearby({ ...ORIGIN, radiusKm: 50 });
    assert.deepEqual(res.body.stores.map((s: any) => s.id), [fx.storeA, fx.storeB, east.id], "sorted by true distance");
  });

  it("handles latitude/longitude as numeric strings, and the antimeridian", async () => {
    const res = await nearby({ latitude: "13.0827", longitude: "80.2707", radiusKm: "25" });
    assert.equal(res.status, 200);
    assert.equal(res.body.stores.length, 2);

    await pool.query("UPDATE stores SET latitude = 0, longitude = 179.9 WHERE id = $1", [fx.storeA]);
    const wrap = await nearby({ latitude: 0, longitude: -179.9, radiusKm: 50 });
    const a = wrap.body.stores.find((s: any) => s.id === fx.storeA);
    assert.ok(a, "store 0.2 degrees away across the antimeridian is found");
    assert.ok(Math.abs(a.distanceKm - 22.2) < 0.3, String(a.distanceKm));
  });

  it("excludes inactive stores", async () => {
    const inactive = await addExtraStore("Closed Store", { lat: ORIGIN.latitude + 0.001, lng: ORIGIN.longitude, active: false });
    const res = await nearby(ORIGIN);
    assert.ok(!res.body.stores.some((s: any) => s.id === inactive.id));
  });

  it("stores with missing coordinates never crash the search and are reported, not ranked", async () => {
    const missing = await addExtraStore("No Coords Store", {});
    await pool.query("UPDATE stores SET latitude = NULL, longitude = NULL WHERE id = $1", [fx.storeB]);

    const res = await nearby(ORIGIN);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.stores.map((s: any) => s.id), [fx.storeA]);
    assert.equal(res.body.search.unlocatedStoreCount, 2);

    // Browse mode still lists them, with a null distance.
    const all = await nearby({});
    assert.equal(all.status, 200);
    assert.equal(all.body.search.mode, "browse");
    const m = all.body.stores.find((s: any) => s.id === missing.id);
    assert.ok(m);
    assert.equal(m.distanceKm, null);
  });

  it("legacy rows holding out-of-range coordinates are ignored, not fatal", async () => {
    const legacy = await addExtraStore("Legacy Bad Store", {});
    // The migration's constraints are NOT VALID (they stop NEW bad data). Drop them to simulate a pre-existing row.
    await pool.query("ALTER TABLE stores DROP CONSTRAINT stores_latitude_range, DROP CONSTRAINT stores_coordinates_pair");
    try {
      await pool.query("UPDATE stores SET latitude = 999.5, longitude = 10 WHERE id = $1", [legacy.id]);
      const res = await nearby({ ...ORIGIN, radiusKm: 500 });
      assert.equal(res.status, 200);
      assert.ok(!res.body.stores.some((s: any) => s.id === legacy.id));
      assert.ok(res.body.search.unlocatedStoreCount >= 1);

      await pool.query("UPDATE stores SET latitude = 'NaN', longitude = 10 WHERE id = $1", [legacy.id]);
      assert.equal((await nearby({ ...ORIGIN, radiusKm: 500 })).status, 200);

      // An owner can still edit other fields of such a store without touching the bad value.
      const edit = await call(legacy.owner.token, "PUT", "/stores", {
        name: "Legacy Bad Store",
        slug: "legacy-bad-store",
        email: "legacy@store.test",
        address: "1 Main Street",
        city: "Chennai",
        state: "TN",
        postalCode: "600001",
        country: "IN",
        phone: "123",
      });
      assert.equal(edit.status, 200, JSON.stringify(edit.body));
    } finally {
      await pool.query("DELETE FROM stores WHERE id = $1", [legacy.id]);
      await pool.query(
        `ALTER TABLE stores
           ADD CONSTRAINT stores_latitude_range CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)) NOT VALID,
           ADD CONSTRAINT stores_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL)) NOT VALID`
      );
    }
  });

  it("clear empty state: no stores in range", async () => {
    const res = await nearby({ latitude: -33.8688, longitude: 151.2093, radiusKm: 10 }); // Sydney
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.stores, []);
    assert.equal(res.body.pagination.total, 0);
    assert.equal(res.body.pagination.totalPages, 1);
  });

  it("paginates in distance order", async () => {
    const p1 = await nearby({ ...ORIGIN, limit: 1, page: 1 });
    const p2 = await nearby({ ...ORIGIN, limit: 1, page: 2 });
    const p3 = await nearby({ ...ORIGIN, limit: 1, page: 3 });
    assert.equal(p1.body.stores[0].id, fx.storeA);
    assert.equal(p2.body.stores[0].id, fx.storeB);
    assert.equal(p3.body.stores.length, 0);
    assert.deepEqual(p1.body.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it("reports how many available books each store has", async () => {
    let res = await nearby(ORIGIN);
    assert.equal(res.body.stores.find((s: any) => s.id === fx.storeA).availableBookCount, 1);
    await pool.query("UPDATE store_book_inventory SET reserved = quantity WHERE store_id = $1", [fx.storeA]);
    res = await nearby(ORIGIN);
    assert.equal(res.body.stores.find((s: any) => s.id === fx.storeA).availableBookCount, 0);
  });

  it("is public (no token) and also works for any logged-in role", async () => {
    assert.equal((await nearby(ORIGIN)).status, 200);
    for (const t of [fx.customer1.token, fx.ownerA.token]) {
      assert.equal((await call(t, "POST", "/stores/nearby", ORIGIN)).status, 200);
    }
  });
});

// ---------------------------------------------------------------------------
describe("POST /stores/nearby: manual-location (text) mode", () => {
  beforeEach(async () => {
    await placeStore(fx.storeA, 0.045, { city: "Chennai", postal: "600001", address: "5 Anna Salai" });
    await pool.query("UPDATE stores SET city = 'Madurai', postal_code = '625001', state = 'Tamil Nadu' WHERE id = $1", [fx.storeB]);
  });

  it("matches city, postal code, state, address and name case-insensitively", async () => {
    const ids = async (query: string) => (await nearby({ query })).body.stores.map((s: any) => s.id);
    assert.deepEqual(await ids("madurai"), [fx.storeB]);
    assert.deepEqual(await ids("600001"), [fx.storeA]);
    assert.deepEqual(await ids("tamil"), [fx.storeB]);
    assert.deepEqual(await ids("anna salai"), [fx.storeA]);
    assert.deepEqual(await ids("STORE A"), [fx.storeA]);
    assert.deepEqual(await ids("  madurai   "), [fx.storeB]);
    assert.equal((await nearby({ query: "madurai" })).body.search.mode, "text");
  });

  it("treats % and _ literally and is not vulnerable to SQL injection", async () => {
    for (const q of ["%", "_", "\\", "' OR '1'='1", "'; DROP TABLE stores; --"]) {
      const res = await nearby({ query: q });
      assert.equal(res.status, 200, q);
      assert.deepEqual(res.body.stores, [], `"${q}" must match nothing`);
    }
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM stores")).rows[0].n, 2);
  });

  it("can be combined with coordinates", async () => {
    const res = await nearby({ ...ORIGIN, query: "anna" });
    assert.deepEqual(res.body.stores.map((s: any) => s.id), [fx.storeA]);
  });

  it("shows a clear empty list when nothing matches", async () => {
    const res = await nearby({ query: "Atlantis" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.stores, []);
  });
});

// ---------------------------------------------------------------------------
describe("POST /stores/nearby: parameter validation", () => {
  const bad: Array<[string, unknown]> = [
    ["latitude above 90", { latitude: 91, longitude: 80 }],
    ["latitude below -90", { latitude: -90.5, longitude: 80 }],
    ["longitude above 180", { latitude: 13, longitude: 181 }],
    ["longitude below -180", { latitude: 13, longitude: -200 }],
    ["non-numeric latitude", { latitude: "abc", longitude: 80 }],
    ["NaN string", { latitude: "NaN", longitude: 80 }],
    ["Infinity", { latitude: 13, longitude: "Infinity" }],
    ["boolean coordinate", { latitude: true, longitude: 80 }],
    ["object coordinate", { latitude: { $gt: 0 }, longitude: 80 }],
    ["array coordinate", { latitude: [13], longitude: 80 }],
    ["latitude without longitude", { latitude: 13 }],
    ["longitude without latitude", { longitude: 80 }],
    ["radius zero", { ...ORIGIN, radiusKm: 0 }],
    ["radius negative", { ...ORIGIN, radiusKm: -5 }],
    ["radius too large", { ...ORIGIN, radiusKm: 501 }],
    ["radius not a number", { ...ORIGIN, radiusKm: "far" }],
    ["radius NaN", { ...ORIGIN, radiusKm: "NaN" }],
    ["radius even without coordinates", { radiusKm: 99999 }],
    ["limit zero", { limit: 0 }],
    ["limit too large", { limit: 51 }],
    ["limit fractional", { limit: 2.5 }],
    ["page zero", { page: 0 }],
    ["page negative", { page: -1 }],
    ["page not a number", { page: "x" }],
    ["query not text", { query: 123 }],
    ["query is an object", { query: { a: 1 } }],
    ["query too long", { query: "x".repeat(101) }],
  ];
  for (const [label, body] of bad) {
    it(`rejects ${label} with a clear 422`, async () => {
      const res = await nearby(body);
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(typeof res.body.error, "string");
      assert.ok(res.body.error.length > 5);
    });
  }

  it("rejects a non-object body", async () => {
    assert.equal((await nearby([1, 2])).status, 400);
    assert.equal((await nearby("hello")).status, 400);
    assert.equal((await nearby(null)).status, 400);
  });

  it("does not echo the submitted coordinates back in an error", async () => {
    const res = await nearby({ latitude: 999.123456, longitude: 80.654321 });
    assert.equal(res.status, 422);
    assert.ok(!JSON.stringify(res.body).includes("999.123456"));
  });

  it("coordinates cannot be supplied in a URL: no GET variant exists", async () => {
    const res = await publicCall("GET", "/stores/nearby?latitude=13.08&longitude=80.27");
    assert.equal(res.status, 404);
  });

  it("an empty body is a valid 'browse all stores' request", async () => {
    const res = await nearby({});
    assert.equal(res.status, 200);
    assert.equal(res.body.search.mode, "browse");
    assert.equal(res.body.stores.length, 2);
  });
});

// ---------------------------------------------------------------------------
describe("public data privacy", () => {
  it("returns only the whitelisted public fields", async () => {
    await placeStore(fx.storeA, 0.045, { city: "Chennai" });
    await pool.query(
      "UPDATE stores SET email = 'secret-owner@private.test', phone = '+91 11111 22222', description = 'A shop' WHERE id = $1",
      [fx.storeA]
    );
    const res = await nearby({ ...ORIGIN, latitude: 13.123457, longitude: 80.654321, radiusKm: 100 });
    assert.equal(res.status, 200);
    const store = res.body.stores.find((s: any) => s.id === fx.storeA);
    assert.ok(store);
    assert.deepEqual(Object.keys(store).sort(), [
      "address", "availableBookCount", "city", "country", "description", "distanceKm", "id", "name", "postalCode", "slug", "state",
    ]);
    const text = JSON.stringify(res.body);
    for (const secret of [
      "secret-owner@private.test", "+91 11111 22222", fx.ownerA.id, "owner", "email", "phone", "latitude", "longitude", "password", "token",
    ]) {
      assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `response leaks "${secret}"`);
    }
  });

  it("never echoes the customer's coordinates back", async () => {
    const res = await nearby({ latitude: 13.123457, longitude: 80.654321, radiusKm: 100 });
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes("13.123457") && !text.includes("80.654321"));
    assert.deepEqual(Object.keys(res.body.search).sort(), ["mode", "radiusKm", "unlocatedStoreCount"]);
  });

  it("marks results as non-cacheable for browsers and proxies", async () => {
    const res = await nearby(ORIGIN);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("does not persist the customer's location anywhere in the database", async () => {
    const before = JSON.stringify((await pool.query("SELECT * FROM stores ORDER BY id")).rows);
    const usersBefore = JSON.stringify((await pool.query("SELECT * FROM users ORDER BY id")).rows);
    await nearby({ latitude: 13.123457, longitude: 80.654321 });
    await call(fx.customer1.token, "POST", "/stores/nearby", { latitude: 13.123457, longitude: 80.654321 });
    assert.equal(JSON.stringify((await pool.query("SELECT * FROM stores ORDER BY id")).rows), before);
    assert.equal(JSON.stringify((await pool.query("SELECT * FROM users ORDER BY id")).rows), usersBefore);
  });

  it("does not write the customer's location to the server log", async () => {
    const lines: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      await nearby({ latitude: 13.123457, longitude: 80.654321 });
      await nearby({ latitude: 999.123457, longitude: 80.654321 }); // an error path too
    } finally {
      Object.assign(console, orig);
    }
    assert.ok(!lines.join("\n").includes("13.123457"));
    assert.ok(!lines.join("\n").includes("80.654321"));
  });
});

// ---------------------------------------------------------------------------
describe("GET /stores/:storeId/books (public store inventory)", () => {
  it("lists available books with the STORE's price and available quantity", async () => {
    await placeStore(fx.storeA, 0.045, { city: "Chennai" });
    const res = await publicCall("GET", `/stores/${fx.storeA}/books`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.store.id, fx.storeA);
    assert.equal(res.body.books.length, 1);
    const b = res.body.books[0];
    assert.equal(b.bookId, fx.bookId);
    assert.equal(b.price, 318, "store price, not the 300 catalog price");
    assert.equal(b.availableQuantity, 3);
    assert.deepEqual(Object.keys(b).sort(), ["author", "availableQuantity", "bookId", "coverImageUrl", "isSecondHand", "listingId", "price", "title"]);
    // Store B charges differently for the same book
    const other = await publicCall("GET", `/stores/${fx.storeB}/books`);
    assert.equal(other.body.books[0].price, 350);
  });

  it("availability is quantity minus reserved; sold-out and deactivated listings are hidden", async () => {
    await pool.query("UPDATE store_book_inventory SET reserved = 1 WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId]);
    let res = await publicCall("GET", `/stores/${fx.storeA}/books`);
    assert.equal(res.body.books[0].availableQuantity, 2);

    await pool.query("UPDATE store_book_inventory SET reserved = quantity WHERE store_id = $1", [fx.storeA]);
    res = await publicCall("GET", `/stores/${fx.storeA}/books`);
    assert.deepEqual(res.body.books, []);

    await pool.query("UPDATE store_book_inventory SET reserved = 0, is_active = false WHERE store_id = $1", [fx.storeA]);
    res = await publicCall("GET", `/stores/${fx.storeA}/books`);
    assert.deepEqual(res.body.books, []);
    assert.equal(res.status, 200, "an empty store is still a valid store");
  });

  it("supports search and pagination", async () => {
    await pool.query("INSERT INTO store_book_inventory (store_id, book_id, quantity, price) VALUES ($1, $2, 4, 280)", [fx.storeA, fx.book2Id]);
    const all = await publicCall("GET", `/stores/${fx.storeA}/books`);
    assert.deepEqual(all.body.books.map((b: any) => b.title), ["Book X", "Book Y"]);
    const q = await publicCall("GET", `/stores/${fx.storeA}/books?search=book%20y`);
    assert.deepEqual(q.body.books.map((b: any) => b.title), ["Book Y"]);
    const wild = await publicCall("GET", `/stores/${fx.storeA}/books?search=%25`);
    assert.deepEqual(wild.body.books, []);
    const p2 = await publicCall("GET", `/stores/${fx.storeA}/books?limit=1&page=2`);
    assert.deepEqual(p2.body.books.map((b: any) => b.title), ["Book Y"]);
    assert.equal(p2.body.pagination.total, 2);
  });

  it("404 for inactive or unknown stores, 400 for a malformed id, 422 for bad paging", async () => {
    await pool.query("UPDATE stores SET is_active = false WHERE id = $1", [fx.storeB]);
    assert.equal((await publicCall("GET", `/stores/${fx.storeB}/books`)).status, 404);
    assert.equal((await publicCall("GET", `/stores/00000000-0000-4000-8000-000000000000/books`)).status, 404);
    assert.equal((await publicCall("GET", `/stores/not-a-uuid/books`)).status, 400);
    assert.equal((await publicCall("GET", `/stores/${fx.storeA}/books?limit=999`)).status, 422);
    assert.equal((await publicCall("GET", `/stores/${fx.storeA}/books?page=0`)).status, 422);
  });

  it("exposes only public store fields", async () => {
    await pool.query("UPDATE stores SET email = 'secret-owner@private.test', phone = '999' WHERE id = $1", [fx.storeA]);
    const res = await publicCall("GET", `/stores/${fx.storeA}/books`);
    const text = JSON.stringify(res.body).toLowerCase();
    for (const secret of ["secret-owner@private.test", fx.ownerA.id, "email", "phone", "latitude", "longitude"]) {
      assert.ok(!text.includes(secret.toLowerCase()), secret);
    }
  });

  it("does not shadow the authenticated store routes", async () => {
    assert.equal((await publicCall("GET", "/stores/inventory")).status, 401);
    assert.equal((await publicCall("GET", "/stores/orders")).status, 401);
    assert.equal((await publicCall("GET", "/stores/admin")).status, 401);
    assert.equal((await publicCall("GET", "/stores")).status, 401);
    assert.equal((await call(fx.ownerA.token, "GET", "/stores/inventory")).status, 200);
  });
});

// ---------------------------------------------------------------------------
describe("store-owner location management and authorization", () => {
  const baseForm = (over: Record<string, unknown> = {}) => ({
    name: "Store A",
    slug: "store-a",
    email: "a@store.test",
    address: "1 Main Street",
    city: "Chennai",
    state: "Tamil Nadu",
    postalCode: "600001",
    country: "IN",
    ...over,
  });
  const coordsOf = async (storeId: string) =>
    (await pool.query("SELECT latitude::float8 AS lat, longitude::float8 AS lng FROM stores WHERE id = $1", [storeId])).rows[0];

  it("an owner can set, read back, change and clear their own coordinates", async () => {
    const set = await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: "13.0827", longitude: 80.2707 }));
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(await coordsOf(fx.storeA), { lat: 13.0827, lng: 80.2707 });
    assert.equal(Number(set.body.store.latitude), 13.0827);

    const mine = await call(fx.ownerA.token, "GET", "/stores");
    assert.equal(Number(mine.body.store.longitude), 80.2707);

    const moved = await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 12.9716, longitude: 77.5946 }));
    assert.equal(moved.status, 200);
    assert.deepEqual(await coordsOf(fx.storeA), { lat: 12.9716, lng: 77.5946 });

    const cleared = await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: "", longitude: "" }));
    assert.equal(cleared.status, 200);
    assert.deepEqual(await coordsOf(fx.storeA), { lat: null, lng: null });
  });

  it("an update that omits coordinates leaves them untouched (existing clients keep working)", async () => {
    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 13.5, longitude: 80.5 }));
    const res = await call(fx.ownerA.token, "PUT", "/stores", baseForm({ name: "Store A Renamed" }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await coordsOf(fx.storeA), { lat: 13.5, lng: 80.5 });
  });

  it("a store with no location at all still saves (location is optional)", async () => {
    const res = await call(fx.ownerA.token, "PUT", "/stores", baseForm());
    assert.equal(res.status, 200);
    assert.deepEqual(await coordsOf(fx.storeA), { lat: null, lng: null });
  });

  it("rejects invalid coordinates and changes nothing", async () => {
    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 13.5, longitude: 80.5 }));
    const cases: Array<[string, Record<string, unknown>]> = [
      ["latitude 91", { latitude: 91, longitude: 80 }],
      ["latitude -91", { latitude: -91, longitude: 80 }],
      ["longitude 181", { latitude: 13, longitude: 181 }],
      ["longitude -181", { latitude: 13, longitude: -181 }],
      ["text", { latitude: "north", longitude: "east" }],
      ["NaN", { latitude: "NaN", longitude: "NaN" }],
      ["Infinity", { latitude: "Infinity", longitude: 1 }],
      ["boolean", { latitude: true, longitude: false }],
      ["clearing only the latitude (would leave a half-set pair)", { latitude: "" }],
      ["clearing only the longitude (would leave a half-set pair)", { longitude: null }],
    ];
    for (const [label, over] of cases) {
      const res = await call(fx.ownerA.token, "PUT", "/stores", baseForm(over));
      assert.equal(res.status, 422, `${label}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(await coordsOf(fx.storeA), { lat: 13.5, lng: 80.5 }, `${label} must not change the stored location`);
    }
  });

  it("partial updates merge with the stored pair; a half-set pair is refused", async () => {
    // Store already has both values: sending just one coordinate is a valid partial update.
    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 13.5, longitude: 80.5 }));
    const partial = await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 14 }));
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.deepEqual(await coordsOf(fx.storeA), { lat: 14, lng: 80.5 });

    // Store has no coordinates: a single value would leave a half-set pair -> refused.
    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: "", longitude: "" }));
    for (const over of [{ latitude: 13 }, { longitude: 80 }]) {
      const res = await call(fx.ownerA.token, "PUT", "/stores", baseForm(over));
      assert.equal(res.status, 422, JSON.stringify(over));
      assert.match(res.body.error, /together/);
    }
    assert.deepEqual(await coordsOf(fx.storeA), { lat: null, lng: null });
  });

  it("customers, admins, anonymous users cannot edit store locations", async () => {
    const admin = await createUserWithToken("Admin User", "admin");
    const body = baseForm({ latitude: 1, longitude: 1 });
    assert.equal((await call(fx.customer1.token, "PUT", "/stores", body)).status, 403);
    assert.equal((await call(admin.token, "PUT", "/stores", body)).status, 403);
    assert.equal((await publicCall("PUT", "/stores", body)).status, 401);
    assert.equal((await call(fx.customer1.token, "POST", "/stores", body)).status, 403);
    assert.deepEqual(await coordsOf(fx.storeA), { lat: null, lng: null });
  });

  it("an owner can only ever change their own store, whatever ids they put in the body", async () => {
    await call(fx.ownerB.token, "PUT", "/stores", baseForm({ name: "Store B", slug: "store-b", email: "b@store.test", latitude: 20, longitude: 70 }));
    const res = await call(
      fx.ownerA.token,
      "PUT",
      "/stores",
      baseForm({ id: fx.storeB, storeId: fx.storeB, ownerUserId: fx.ownerB.id, owner_user_id: fx.ownerB.id, latitude: 1, longitude: 2 })
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await coordsOf(fx.storeA), { lat: 1, lng: 2 });
    assert.deepEqual(await coordsOf(fx.storeB), { lat: 20, lng: 70 }, "owner B's store is untouched");
    const owners = await pool.query("SELECT id, owner_user_id FROM stores ORDER BY name");
    assert.equal(owners.rows.find((r: any) => r.id === fx.storeA).owner_user_id, fx.ownerA.id);
  });

  it("creating a store validates optional coordinates too", async () => {
    const owner = await createUserWithToken("Owner New", "store_owner");
    const form = { ...baseForm({ name: "Brand New", slug: "brand-new", email: "new@store.test" }) };

    const bad = await call(owner.token, "POST", "/stores", { ...form, latitude: 95, longitude: 10 });
    assert.equal(bad.status, 422);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM stores WHERE owner_user_id = $1", [owner.id])).rows[0].n, 0);

    const ok = await call(owner.token, "POST", "/stores", { ...form, latitude: "10.5", longitude: "76.25" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const id = ok.body.store.id;
    assert.deepEqual(await coordsOf(id), { lat: 10.5, lng: 76.25 });

    const owner2 = await createUserWithToken("Owner Plain", "store_owner");
    const plain = await call(owner2.token, "POST", "/stores", { ...form, name: "Plain", slug: "plain", email: "p@store.test" });
    assert.equal(plain.status, 201, "creating a store without coordinates still works");
  });

  it("a newly located store appears in nearby results immediately (results are never cached)", async () => {
    assert.deepEqual((await nearby(ORIGIN)).body.stores, [], "no stores have coordinates yet");
    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 13.1, longitude: 80.27 }));
    const first = await nearby(ORIGIN);
    assert.deepEqual(first.body.stores.map((s: any) => s.id), [fx.storeA]);

    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ latitude: 28.6, longitude: 77.2 })); // moved to Delhi
    assert.deepEqual((await nearby(ORIGIN)).body.stores, []);

    await call(fx.ownerA.token, "PUT", "/stores", baseForm({ name: "Renamed A", latitude: 13.1, longitude: 80.27 }));
    assert.equal((await nearby(ORIGIN)).body.stores[0].name, "Renamed A");
  });

  it("the database itself rejects new out-of-range or half-set coordinates", async () => {
    const bad = (lat: string, lng: string) => pool.query("UPDATE stores SET latitude = $1, longitude = $2 WHERE id = $3", [lat, lng, fx.storeA]);
    await assert.rejects(bad("90.000001", "0"), { code: "23514" });
    await assert.rejects(bad("-91", "0"), { code: "23514" });
    await assert.rejects(bad("0", "180.5"), { code: "23514" });
    await assert.rejects(bad("NaN", "0"), { code: "23514" });
    await assert.rejects(pool.query("UPDATE stores SET latitude = 5, longitude = NULL WHERE id = $1", [fx.storeA]), { code: "23514" });
    await bad("90", "180");
    await bad("-90", "-180");
  });

  it("the migration can be applied repeatedly without error", async () => {
    await applyMigrations();
    await applyMigrations();
    const idx = await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_stores_active_latitude'");
    assert.equal(idx.rows.length, 1);
    assert.match(idx.rows[0].indexdef, /btree/i, "a plain B-tree index, not a spatial one");
    const cons = await pool.query("SELECT conname FROM pg_constraint WHERE conname IN ('stores_latitude_range','stores_longitude_range','stores_coordinates_pair')");
    assert.equal(cons.rows.length, 3);
  });
});

// ---------------------------------------------------------------------------
describe("existing store-listing behaviour is unchanged", () => {
  it("GET /books/:id/store-listings still lists both stores cheapest-first with the same fields", async () => {
    const res = await publicCall("GET", `/books/${fx.bookId}/store-listings`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.listings.map((l: any) => [l.storeId, l.price, l.availableQuantity]), [
      [fx.storeA, 318, 3],
      [fx.storeB, 350, 3],
    ]);
    assert.deepEqual(Object.keys(res.body.listings[0]).sort(), ["availableQuantity", "city", "listingId", "price", "state", "storeId", "storeName"]);
  });

  it("store inventory management still works for the owner", async () => {
    const inv = await call(fx.ownerA.token, "GET", "/stores/inventory");
    assert.equal(inv.status, 200);
    assert.ok(JSON.stringify(inv.body).includes(fx.bookId));
  });

  it("discover -> store books -> add to cart -> checkout -> cancel works end to end and restores stock", async () => {
    await placeStore(fx.storeA, 0.045, { city: "Chennai" });
    const found = await nearby(ORIGIN);
    const store = found.body.stores[0];
    const books = await publicCall("GET", `/stores/${store.id}/books`);
    const pick = books.body.books[0];

    const add = await call(fx.customer1.token, "POST", "/cart", { bookId: pick.bookId, quantity: 2, storeId: store.id });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const stock = () => pool.query("SELECT quantity, reserved FROM store_book_inventory WHERE store_id = $1 AND book_id = $2", [store.id, pick.bookId]);
    assert.equal((await stock()).rows[0].reserved, 2);

    const co = await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" });
    assert.equal(co.status, 201, JSON.stringify(co.body));
    assert.equal((await stock()).rows[0].quantity, 1);

    const cancel = await call(fx.customer1.token, "POST", `/orders/${co.body.order.id}/cancel`);
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    const after = (await stock()).rows[0];
    assert.deepEqual({ q: after.quantity, r: after.reserved }, { q: 3, r: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("cache invalidation on location change", { skip: !hasRedis && "set TEST_REDIS_URL to run" }, () => {
  it("updating a store's location/public details clears every store-listings cache", async () => {
    const keys = [`book:store-listings:${fx.bookId}`, `book:store-listings:${fx.book2Id}`];
    for (const k of keys) await redisClient.set(k, "stale");
    const res = await call(fx.ownerA.token, "PUT", "/stores", {
      name: "Store A",
      slug: "store-a",
      email: "a@store.test",
      address: "1 Main Street",
      city: "Chennai",
      state: "TN",
      postalCode: "600001",
      country: "IN",
      latitude: 13.0,
      longitude: 80.2,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    for (const k of keys) assert.equal(await redisClient.exists(k), 0, `${k} should be cleared`);
  });

  it("a rejected location update leaves caches alone", async () => {
    const key = `book:store-listings:${fx.bookId}`;
    await redisClient.set(key, "fresh");
    const res = await call(fx.ownerA.token, "PUT", "/stores", {
      name: "Store A", slug: "store-a", email: "a@store.test", address: "1 Main Street",
      city: "Chennai", state: "TN", postalCode: "600001", country: "IN", latitude: 500, longitude: 1,
    });
    assert.equal(res.status, 422);
    assert.equal(await redisClient.exists(key), 1);
    await redisClient.del(key);
  });

  it("nearby searches write nothing to Redis", async () => {
    const before = await redisClient.dbSize();
    await nearby({ latitude: 13.123457, longitude: 80.654321 });
    await publicCall("GET", `/stores/${fx.storeA}/books`);
    assert.equal(await redisClient.dbSize(), before);
  });
});
