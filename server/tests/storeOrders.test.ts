import "./helpers"; // must stay first: sets test-only env vars before the app loads
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  pool,
  applyMigrations,
  startTestServer,
  resetAndSeed,
  makeApi,
  createUserWithToken,
  createOrder,
  Fixtures,
} from "./helpers";

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

/** Every number anywhere in a JSON value (avoids flaky substring matches against UUID digits). */
function allNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allNumbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => allNumbers(v, out));
  return out;
}

const list = (token: string, query = "") => call(token, "GET", `/stores/orders${query}`);
const detail = (token: string, orderId: string) => call(token, "GET", `/stores/orders/${orderId}`);

describe("owner sees only their own store's lines", () => {
  it("owner A and owner B each see only their own orders", async () => {
    const orderA = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 2, unitPrice: 318 }]);
    const orderB = await createOrder(fx.customer2.id, [{ bookId: fx.bookId, storeId: fx.storeB, quantity: 1, unitPrice: 350 }]);

    const a = await list(fx.ownerA.token);
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.orders.map((o: any) => o.id), [orderA]);
    assert.equal(a.body.orders[0].items[0].quantity, 2);
    assert.equal(a.body.orders[0].items[0].unitPrice, 318);
    assert.equal(a.body.orders[0].items[0].lineTotal, 636);
    assert.equal(a.body.orders[0].items[0].title, "Book X");
    assert.equal(a.body.orders[0].storeTotal, 636);
    assert.equal(a.body.orders[0].status, "PLACED");
    assert.ok(a.body.orders[0].createdAt);

    const b = await list(fx.ownerB.token);
    assert.deepEqual(b.body.orders.map((o: any) => o.id), [orderB]);
    assert.equal(b.body.orders[0].storeTotal, 350);
  });

  it("a mixed-store order shows each owner only their own lines and totals (legacy line hidden from both)", async () => {
    const mixed = await createOrder(fx.customer1.id, [
      { bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 },
      { bookId: fx.book2Id, storeId: fx.storeB, quantity: 3, unitPrice: 120.5 },
      { bookId: fx.book2Id, storeId: null, quantity: 4, unitPrice: 999 }, // legacy line in the same order
    ]);

    const a = (await list(fx.ownerA.token)).body.orders;
    assert.equal(a.length, 1);
    assert.equal(a[0].id, mixed);
    assert.equal(a[0].items.length, 1);
    assert.equal(a[0].items[0].title, "Book X");
    assert.equal(a[0].storeTotal, 318);

    const b = (await list(fx.ownerB.token)).body.orders;
    assert.equal(b.length, 1);
    assert.equal(b[0].items.length, 1);
    assert.equal(b[0].items[0].title, "Book Y");
    assert.equal(b[0].items[0].lineTotal, 361.5);
    assert.equal(b[0].storeTotal, 361.5);

    // Neither response leaks the whole-order total (1 * 318 + 3 * 120.5 + 4 * 999) or the legacy price.
    for (const orders of [a, b]) {
      const numbers = allNumbers(orders);
      assert.ok(!numbers.includes(999), "legacy line must not appear");
      assert.ok(!numbers.includes(4675.5), "whole-order total must not appear");
    }

    // Detail view is scoped the same way.
    const dA = await detail(fx.ownerA.token, mixed);
    assert.equal(dA.status, 200);
    assert.equal(dA.body.order.items.length, 1);
    assert.equal(dA.body.order.storeTotal, 318);
    const dB = await detail(fx.ownerB.token, mixed);
    assert.equal(dB.body.order.items.length, 1);
    assert.equal(dB.body.order.items[0].title, "Book Y");
  });

  it("an owner with no orders gets an empty list", async () => {
    await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }]);
    const res = await list(fx.ownerB.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.orders, []);
    assert.deepEqual(res.body.pagination, { page: 1, limit: 10, total: 0, totalPages: 1 });
  });

  it("legacy-only orders (no store) appear for no owner", async () => {
    const legacy = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    assert.deepEqual((await list(fx.ownerA.token)).body.orders, []);
    assert.deepEqual((await list(fx.ownerB.token)).body.orders, []);
    assert.equal((await detail(fx.ownerA.token, legacy)).status, 404);
  });

  it("shows the recorded unit price, not the store's current listing price", async () => {
    await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }]);
    await pool.query("UPDATE store_book_inventory SET price = 999 WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId]);
    const res = await list(fx.ownerA.token);
    assert.equal(res.body.orders[0].items[0].unitPrice, 318);
  });

  it("cancelled orders show as CANCELLED", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }], {
      status: "CANCELLED",
    });
    const l = await list(fx.ownerA.token);
    assert.equal(l.body.orders[0].status, "CANCELLED");
    assert.equal((await detail(fx.ownerA.token, id)).body.order.status, "CANCELLED");
  });
});

describe("detail endpoint", () => {
  it("404s for an order that only has another store's items, same as a non-existent order", async () => {
    const onlyB = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeB, quantity: 1, unitPrice: 350 }]);
    const forbidden = await detail(fx.ownerA.token, onlyB);
    const missing = await detail(fx.ownerA.token, "11111111-1111-4111-8111-111111111111");
    assert.equal(forbidden.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(forbidden.body, missing.body, "must not reveal whether the order exists");
  });

  it("returns 400 for malformed order IDs", async () => {
    for (const bad of ["not-a-uuid", "123", "1111", "%27%20OR%201%3D1--"]) {
      const res = await detail(fx.ownerA.token, bad);
      assert.equal(res.status, 400, `id "${bad}"`);
    }
  });

  it("returns the owner's lines with customer fulfilment details", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 2, unitPrice: 318 }], {
      shippingAddress: "7 Park Road, Chennai 600028",
    });
    const res = await detail(fx.ownerA.token, id);
    assert.equal(res.status, 200);
    assert.equal(res.body.order.customer.name, "Customer One");
    assert.equal(res.body.order.customer.shippingAddress, "7 Park Road, Chennai 600028");
  });
});

describe("access control", () => {
  it("rejects anonymous callers with 401 and customers/admins with 403", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }]);
    const admin = await createUserWithToken("Admin User", "admin");

    for (const url of ["/stores/orders", `/stores/orders/${id}`]) {
      const anon = await fetch(`${server.baseUrl}${url}`);
      assert.equal(anon.status, 401, `anonymous ${url}`);
      assert.equal((await call(fx.customer1.token, "GET", url)).status, 403, `customer ${url}`);
      assert.equal((await call(admin.token, "GET", url)).status, 403, `admin ${url}`);
    }
  });

  it("a store owner who has not created a store gets a clear 404", async () => {
    const noStore = await createUserWithToken("Owner Without Store", "store_owner");
    const l = await list(noStore.token);
    assert.equal(l.status, 404);
    assert.match(l.body.error, /create your store/i);
    const d = await detail(noStore.token, "11111111-1111-4111-8111-111111111111");
    assert.equal(d.status, 404);
  });

  it("the endpoints are read-only (no write methods are exposed)", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }]);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await call(fx.ownerA.token, method, `/stores/orders/${id}`, {})).status, 404, method);
    }
    const row = (await pool.query("SELECT status FROM orders WHERE id = $1", [id])).rows[0];
    assert.equal(row.status, "PLACED");
  });
});

describe("customer privacy", () => {
  it("never exposes the customer's email, user id, payment data or other stores' data", async () => {
    const id = await createOrder(fx.customer1.id, [
      { bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 },
      { bookId: fx.book2Id, storeId: fx.storeB, quantity: 1, unitPrice: 777 },
    ]);
    const responses = [(await list(fx.ownerA.token)).body, (await detail(fx.ownerA.token, id)).body];
    for (const response of responses) {
      const text = JSON.stringify(response);
      assert.ok(!allNumbers(response).includes(777), "other store's line leaked");
      assert.ok(!text.includes("customerone@test.local"), "email leaked");
      assert.ok(!/email/i.test(text), "an email field is present");
      assert.ok(!text.includes(fx.customer1.id), "customer user id leaked");
      assert.ok(!/payment|subtotal/i.test(text), "payment/whole-order data leaked");
      assert.ok(!/"total":/.test(text.replace(/"pagination":\{[^}]*\}/, "")), "whole-order total leaked");
      assert.ok(!text.includes(fx.storeB), "other store id leaked");
    }
  });

  it("sends Cache-Control: no-store because responses hold customer details", async () => {
    const res = await fetch(`${server.baseUrl}/stores/orders`, { headers: { Authorization: `Bearer ${fx.ownerA.token}` } });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

describe("pagination", () => {
  it("pages per order (newest first), counts orders not lines, and clamps bad input", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await createOrder(
          fx.customer1.id,
          [
            { bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 },
            { bookId: fx.book2Id, storeId: fx.storeA, quantity: 1, unitPrice: 100 },
          ],
          { createdAt: `2026-01-0${i + 1}T10:00:00Z` }
        )
      );
    }
    // oldest .. newest = ids[0] .. ids[2]
    const p1 = (await list(fx.ownerA.token, "?page=1&limit=2")).body;
    assert.deepEqual(p1.orders.map((o: any) => o.id), [ids[2], ids[1]]);
    assert.equal(p1.orders[0].items.length, 2, "both lines of an order come back together");
    assert.deepEqual(p1.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });

    const p2 = (await list(fx.ownerA.token, "?page=2&limit=2")).body;
    assert.deepEqual(p2.orders.map((o: any) => o.id), [ids[0]]);

    const beyond = (await list(fx.ownerA.token, "?page=9&limit=2")).body;
    assert.deepEqual(beyond.orders, []);
    assert.equal(beyond.pagination.total, 3);

    const clamped = (await list(fx.ownerA.token, "?page=-4&limit=9999")).body;
    assert.equal(clamped.pagination.page, 1);
    assert.equal(clamped.pagination.limit, 50);
    const garbage = (await list(fx.ownerA.token, "?page=abc&limit=xyz")).body;
    assert.equal(garbage.pagination.page, 1);
    assert.equal(garbage.pagination.limit, 10);
  });
});

describe("end to end with the real checkout", () => {
  it("an order placed through checkout shows up for the store that sold it, and legacy checkout stays invisible to owners", async () => {
    // Store line (Book X from Store A) + legacy line (Book Y) in one cart.
    await call(fx.customer1.token, "POST", "/cart", { bookId: fx.bookId, quantity: 2, storeId: fx.storeA });
    await call(fx.customer1.token, "POST", "/cart", { bookId: fx.book2Id, quantity: 1 });
    const checkout = await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "42 Anna Salai, Chennai 600002" });
    assert.equal(checkout.status, 201);

    const a = (await list(fx.ownerA.token)).body.orders;
    assert.equal(a.length, 1);
    assert.equal(a[0].items.length, 1, "legacy line is not shown");
    assert.equal(a[0].items[0].quantity, 2);
    assert.equal(a[0].items[0].unitPrice, 318);
    assert.equal(a[0].customer.shippingAddress, "42 Anna Salai, Chennai 600002");
    assert.equal((await list(fx.ownerB.token)).body.orders.length, 0);

    // A purely legacy checkout never appears for any owner.
    await call(fx.customer2.token, "POST", "/cart", { bookId: fx.book2Id, quantity: 1 });
    assert.equal((await call(fx.customer2.token, "POST", "/orders/checkout", { shippingAddress: "9 Legacy Lane, Chennai" })).status, 201);
    assert.equal((await list(fx.ownerA.token)).body.orders.length, 1);
    assert.equal((await list(fx.ownerB.token)).body.orders.length, 0);
  });
});
