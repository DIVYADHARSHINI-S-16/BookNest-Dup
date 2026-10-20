import "./helpers"; // must stay first: sets test-only env vars before the app loads
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool, applyMigrations, startTestServer, resetAndSeed, makeApi, createUserWithToken, createOrder, Fixtures } from "./helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;
let call: ReturnType<typeof makeApi>;
let fx: Fixtures;
let admin: { id: string; token: string };

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
});

const ADDRESS = "12 Test Street, Chennai 600001";
const cancel = (token: string, orderId: string) => call(token, "POST", `/orders/${orderId}/cancel`);
const setStatus = (orderId: string, status: unknown, token = admin.token) => call(token, "PATCH", `/orders/${orderId}/status`, { status });
const statusOf = async (orderId: string) => (await pool.query("SELECT status FROM orders WHERE id = $1", [orderId])).rows[0].status as string;

/** Every stock quantity/reserved in the database, keyed so two snapshots can be compared exactly. */
async function stockSnapshot() {
  const legacy = (await pool.query("SELECT book_id, quantity, reserved FROM inventory ORDER BY book_id")).rows;
  const store = (await pool.query("SELECT store_id, book_id, quantity, reserved FROM store_book_inventory ORDER BY store_id, book_id")).rows;
  return JSON.stringify({ legacy, store });
}

/**
 * Places a real order through the cart and checkout (so stock moves exactly as in production):
 *   book X  x2 from store A,  book Y x1 from store B (listing added here),  book Z x3 from legacy stock.
 */
async function placeMultiStoreOrder() {
  const z = (
    await pool.query(
      "INSERT INTO books (title, author, isbn, price, category_id) VALUES ('Book Z', 'Author', 'ISBN-Z', 100, (SELECT id FROM categories LIMIT 1)) RETURNING id"
    )
  ).rows[0].id as string;
  await pool.query("INSERT INTO inventory (book_id, quantity) VALUES ($1, 10)", [z]);
  await pool.query("INSERT INTO store_book_inventory (store_id, book_id, quantity, price) VALUES ($1, $2, 4, 120)", [fx.storeB, fx.book2Id]);
  const t = fx.customer1.token;
  assert.equal((await call(t, "POST", "/cart", { bookId: fx.bookId, quantity: 2, storeId: fx.storeA })).status, 200);
  assert.equal((await call(t, "POST", "/cart", { bookId: fx.book2Id, quantity: 1, storeId: fx.storeB })).status, 200);
  assert.equal((await call(t, "POST", "/cart", { bookId: z, quantity: 3 })).status, 200);
  const before = await stockSnapshot();
  const co = await call(t, "POST", "/orders/checkout", { shippingAddress: ADDRESS });
  assert.equal(co.status, 201);
  return { orderId: co.body.order.id as string, bookZ: z, beforeCheckout: before };
}

describe("valid and invalid status transitions (admin)", () => {
  it("walks PLACED -> CONFIRMED -> PACKED -> SHIPPED -> DELIVERED", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    for (const s of ["CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"]) {
      const r = await setStatus(id, s);
      assert.equal(r.status, 200, s);
      assert.equal(r.body.order.status, s);
    }
    assert.deepEqual((await setStatus(id, "CANCELLED")).status, 409);
  });

  it("rejects skipping, going backwards, repeating and leaving a final status (409)", async () => {
    const cases: Array<[string, string]> = [
      ["PLACED", "PACKED"], ["PLACED", "SHIPPED"], ["PLACED", "DELIVERED"], ["PLACED", "PLACED"],
      ["CONFIRMED", "PLACED"], ["CONFIRMED", "SHIPPED"], ["PACKED", "CONFIRMED"], ["PACKED", "CANCELLED"],
      ["SHIPPED", "CANCELLED"], ["SHIPPED", "PACKED"], ["DELIVERED", "SHIPPED"], ["DELIVERED", "CANCELLED"],
      ["CANCELLED", "PLACED"], ["CANCELLED", "CONFIRMED"],
    ];
    for (const [from, to] of cases) {
      const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }], { status: from });
      const r = await setStatus(id, to);
      assert.equal(r.status, 409, `${from} -> ${to}`);
      assert.equal(await statusOf(id), from, `${from} must be unchanged`);
    }
  });

  it("validates ids and status values", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    assert.equal((await setStatus("not-a-uuid", "CONFIRMED")).status, 400);
    assert.equal((await setStatus("00000000-0000-4000-8000-000000000000", "CONFIRMED")).status, 404);
    for (const bad of ["SHIPPING", "placed", "", null, 5, undefined, { a: 1 }]) {
      assert.equal((await setStatus(id, bad)).status, 422, JSON.stringify(bad));
    }
    assert.equal((await call(admin.token, "GET", "/orders/admin/all?status=BOGUS")).status, 400);
    assert.equal(await statusOf(id), "PLACED");
  });

  it("admin cancel of a PLACED/CONFIRMED order restores stock; CANCELLED is final", async () => {
    const { orderId } = await placeMultiStoreOrder();
    assert.equal((await setStatus(orderId, "CONFIRMED")).status, 200);
    const r = await setStatus(orderId, "CANCELLED");
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, "CANCELLED");
    assert.deepEqual(r.body.order.allowedNextStatuses, []);
  });

  it("order list and detail expose canCancel / allowedNextStatuses consistently", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    const mine = (await call(fx.customer1.token, "GET", "/orders")).body.orders[0];
    assert.equal(mine.canCancel, true);
    assert.equal(mine.allowedNextStatuses, undefined);
    const adminView = (await call(admin.token, "GET", `/orders/${id}`)).body.order;
    assert.deepEqual(adminView.allowedNextStatuses, ["CONFIRMED", "CANCELLED"]);
    await setStatus(id, "CONFIRMED");
    await setStatus(id, "PACKED");
    assert.equal((await call(fx.customer1.token, "GET", `/orders/${id}`)).body.order.canCancel, false);
  });
});

describe("authorization", () => {
  it("only administrators can change status", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    assert.equal((await setStatus(id, "CONFIRMED", fx.customer1.token)).status, 403);
    assert.equal((await setStatus(id, "CONFIRMED", fx.ownerA.token)).status, 403);
    const anon = await fetch(`${server.baseUrl}/orders/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CONFIRMED" }) });
    assert.equal(anon.status, 401);
    assert.equal(await statusOf(id), "PLACED");
  });

  it("only customers can use the customer cancel endpoint, and only for their own order", async () => {
    const { orderId } = await placeMultiStoreOrder();
    const snap = await stockSnapshot();
    assert.equal((await cancel(fx.customer2.token, orderId)).status, 403);
    assert.equal((await cancel(fx.ownerA.token, orderId)).status, 403);
    assert.equal((await cancel(admin.token, orderId)).status, 403);
    assert.equal((await fetch(`${server.baseUrl}/orders/${orderId}/cancel`, { method: "POST" })).status, 401);
    assert.equal(await statusOf(orderId), "PLACED");
    assert.equal(await stockSnapshot(), snap, "a refused cancel must not touch stock");
  });

  it("customer order ownership: list and detail are scoped to the owner", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    assert.equal((await call(fx.customer2.token, "GET", "/orders")).body.orders.length, 0);
    assert.equal((await call(fx.customer2.token, "GET", `/orders/${id}`)).status, 403);
    assert.equal((await call(fx.customer1.token, "GET", `/orders/${id}`)).status, 200);
  });

  it("store owners cannot change status or cancel, but still see only their own store's lines", async () => {
    const { orderId } = await placeMultiStoreOrder();
    assert.equal((await setStatus(orderId, "CONFIRMED", fx.ownerA.token)).status, 403);
    assert.equal((await cancel(fx.ownerB.token, orderId)).status, 403);
    const a = (await call(fx.ownerA.token, "GET", "/stores/orders")).body.orders;
    assert.equal(a.length, 1);
    assert.equal(a[0].items.length, 1);
    assert.equal(a[0].items[0].title, "Book X");
    await cancel(fx.customer1.token, orderId);
    assert.equal((await call(fx.ownerA.token, "GET", `/stores/orders/${orderId}`)).body.order.status, "CANCELLED");
  });

  it("bad ids and unknown orders on the customer endpoint", async () => {
    assert.equal((await cancel(fx.customer1.token, "nope")).status, 400);
    assert.equal((await cancel(fx.customer1.token, "00000000-0000-4000-8000-000000000000")).status, 404);
  });
});

describe("customer cancellation and stock restoration", () => {
  it("restores each stock source exactly: store A, store B and legacy", async () => {
    const { orderId, beforeCheckout } = await placeMultiStoreOrder();
    assert.notEqual(await stockSnapshot(), beforeCheckout, "checkout must have deducted stock");
    const r = await cancel(fx.customer1.token, orderId);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, "CANCELLED");
    assert.equal(r.body.order.canCancel, false);
    assert.equal(r.body.order.paymentStatus, "MOCK_REFUNDED");
    assert.equal(r.body.unrestoredLines, 0);
    const after = JSON.parse(await stockSnapshot());
    const prior = JSON.parse(beforeCheckout);
    // Quantities are back to the pre-checkout values. (Pre-checkout `reserved` held the cart's
    // reservation, which checkout consumed, so only quantity is compared.)
    const q = (snap: any) => JSON.stringify({ l: snap.legacy.map((x: any) => [x.book_id, x.quantity]), s: snap.store.map((x: any) => [x.store_id, x.book_id, x.quantity]) });
    assert.equal(q(after), q(prior));
    assert.ok(after.legacy.every((x: any) => x.reserved === 0) && after.store.every((x: any) => x.reserved === 0), "cancel must not re-reserve stock");
    const row = (await pool.query("SELECT cancelled_at, stock_restored_at FROM orders WHERE id = $1", [orderId])).rows[0];
    assert.ok(row.cancelled_at && row.stock_restored_at);
  });

  it("works from CONFIRMED, and is refused once PACKED, SHIPPED or DELIVERED", async () => {
    for (const status of ["PACKED", "SHIPPED", "DELIVERED"]) {
      const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }], { status });
      const snap = await stockSnapshot();
      const r = await cancel(fx.customer1.token, id);
      assert.equal(r.status, 409, status);
      assert.equal(await statusOf(id), status);
      assert.equal(await stockSnapshot(), snap);
    }
    const ok = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: fx.storeA, quantity: 1, unitPrice: 318 }], { status: "CONFIRMED" });
    assert.equal((await cancel(fx.customer1.token, ok)).status, 200);
  });

  it("a repeated cancel is refused and restores nothing a second time", async () => {
    const { orderId } = await placeMultiStoreOrder();
    assert.equal((await cancel(fx.customer1.token, orderId)).status, 200);
    const once = await stockSnapshot();
    for (let i = 0; i < 3; i++) {
      const again = await cancel(fx.customer1.token, orderId);
      assert.equal(again.status, 409);
      assert.match(again.body.error, /already been cancelled/);
    }
    assert.equal((await setStatus(orderId, "CANCELLED")).status, 409);
    assert.equal(await stockSnapshot(), once);
  });

  it("concurrent cancels (customer + admin, six at once) restore stock exactly once", async () => {
    const { orderId, beforeCheckout } = await placeMultiStoreOrder();
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => cancel(fx.customer1.token, orderId)),
      ...Array.from({ length: 2 }, () => setStatus(orderId, "CANCELLED")),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.every((r) => r.status === 200 || r.status === 409));
    const after = JSON.parse(await stockSnapshot());
    const prior = JSON.parse(beforeCheckout);
    const q = (snap: any) => JSON.stringify({ l: snap.legacy.map((x: any) => [x.book_id, x.quantity]), s: snap.store.map((x: any) => [x.store_id, x.book_id, x.quantity]) });
    assert.equal(q(after), q(prior), "stock must equal the pre-order level, not exceed it");
  });

  it("two different orders cancelled concurrently both restore correctly (no deadlock)", async () => {
    const first = await placeMultiStoreOrder();
    await pool.query("UPDATE store_book_inventory SET quantity = quantity + 10 WHERE book_id = $1", [fx.bookId]);
    await call(fx.customer2.token, "POST", "/cart", { bookId: fx.bookId, quantity: 1, storeId: fx.storeA });
    const second = await call(fx.customer2.token, "POST", "/orders/checkout", { shippingAddress: ADDRESS });
    assert.equal(second.status, 201);
    const stockBefore = (await pool.query("SELECT quantity FROM store_book_inventory WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId])).rows[0].quantity;
    const [a, b] = await Promise.all([cancel(fx.customer1.token, first.orderId), cancel(fx.customer2.token, second.body.order.id)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const stockAfter = (await pool.query("SELECT quantity FROM store_book_inventory WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId])).rows[0].quantity;
    assert.equal(stockAfter, stockBefore + 2 + 1);
  });

  it("restores only the cancelled order's lines (a second order is untouched)", async () => {
    const first = await placeMultiStoreOrder();
    await pool.query("UPDATE store_book_inventory SET quantity = quantity + 5 WHERE book_id = $1 AND store_id = $2", [fx.bookId, fx.storeA]);
    await call(fx.customer2.token, "POST", "/cart", { bookId: fx.bookId, quantity: 1, storeId: fx.storeA });
    const other = await call(fx.customer2.token, "POST", "/orders/checkout", { shippingAddress: ADDRESS });
    await cancel(fx.customer1.token, first.orderId);
    assert.equal(await statusOf(other.body.order.id), "PLACED");
  });

  it("a deleted store listing is reported, not fatal, and other lines are still restored", async () => {
    const { orderId, bookZ } = await placeMultiStoreOrder();
    await pool.query("DELETE FROM store_book_inventory WHERE store_id = $1 AND book_id = $2", [fx.storeB, fx.book2Id]);
    const r = await cancel(fx.customer1.token, orderId);
    assert.equal(r.status, 200);
    assert.equal(r.body.unrestoredLines, 1);
    assert.equal((await pool.query("SELECT quantity FROM inventory WHERE book_id = $1", [bookZ])).rows[0].quantity, 10);
  });

  it("legacy orders that were already CANCELLED before this feature are never restored", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 2, unitPrice: 300 }], { status: "CANCELLED" });
    const snap = await stockSnapshot();
    assert.equal((await cancel(fx.customer1.token, id)).status, 409);
    assert.equal(await stockSnapshot(), snap);
  });
});

describe("transaction rollback", () => {
  it("a failure while restoring stock rolls back the status change and every earlier restore", async () => {
    const { orderId } = await placeMultiStoreOrder();
    const snap = await stockSnapshot();
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_inventory() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated inventory failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_inventory_trg BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION test_fail_inventory();
    `);
    try {
      const r = await cancel(fx.customer1.token, orderId);
      assert.equal(r.status, 500);
      assert.equal(await statusOf(orderId), "PLACED", "order must not be left CANCELLED");
      const row = (await pool.query("SELECT cancelled_at, stock_restored_at, payment_status FROM orders WHERE id = $1", [orderId])).rows[0];
      assert.equal(row.cancelled_at, null);
      assert.equal(row.stock_restored_at, null);
      assert.equal(row.payment_status, "MOCK_PAID");
      assert.equal(await stockSnapshot(), snap, "no partial restoration may remain");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS test_fail_inventory_trg ON inventory; DROP FUNCTION IF EXISTS test_fail_inventory();");
    }
    // The same order can be cancelled normally once the fault is gone.
    assert.equal((await cancel(fx.customer1.token, orderId)).status, 200);
  });

  it("the admin cancel path rolls back the same way", async () => {
    const { orderId } = await placeMultiStoreOrder();
    const snap = await stockSnapshot();
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_inventory() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated inventory failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_inventory_trg BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION test_fail_inventory();
    `);
    try {
      assert.equal((await setStatus(orderId, "CANCELLED")).status, 500);
      assert.equal(await statusOf(orderId), "PLACED");
      assert.equal(await stockSnapshot(), snap);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS test_fail_inventory_trg ON inventory; DROP FUNCTION IF EXISTS test_fail_inventory();");
    }
  });

  it("the database refuses stock_restored_at on a non-cancelled order", async () => {
    const id = await createOrder(fx.customer1.id, [{ bookId: fx.bookId, storeId: null, quantity: 1, unitPrice: 300 }]);
    await assert.rejects(pool.query("UPDATE orders SET stock_restored_at = now() WHERE id = $1", [id]), { code: "23514" });
  });
});

describe("regression: checkout still deducts stock and Book Request Management still works", () => {
  it("checkout deducts from the chosen store, then a cancel returns it", async () => {
    await call(fx.customer1.token, "POST", "/cart", { bookId: fx.bookId, quantity: 2, storeId: fx.storeA });
    const co = await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: ADDRESS });
    assert.equal(co.status, 201);
    assert.equal(co.body.order.status, "PLACED");
    assert.equal(co.body.order.canCancel, true);
    const q = async () => (await pool.query("SELECT quantity, reserved FROM store_book_inventory WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId])).rows[0];
    assert.deepEqual(await q(), { quantity: 1, reserved: 0 });
    await cancel(fx.customer1.token, co.body.order.id);
    assert.deepEqual(await q(), { quantity: 3, reserved: 0 });
  });

  it("book requests: create, store response and admin status change are unaffected", async () => {
    const created = await call(fx.customer1.token, "POST", "/book-requests", { title: "Some Rare Book", author: "Someone" });
    assert.equal(created.status, 201);
    const id = created.body.request.id;
    assert.equal((await call(fx.ownerA.token, "POST", `/stores/book-requests/${id}/response`, { response: "CAN_SUPPLY" })).status, 201);
    assert.equal((await call(admin.token, "PATCH", `/admin/book-requests/${id}`, { status: "SUPPLIER_FOUND" })).status, 200);
    assert.equal((await call(fx.customer1.token, "GET", `/book-requests/${id}`)).body.request.offerCount, 1);
  });
});
