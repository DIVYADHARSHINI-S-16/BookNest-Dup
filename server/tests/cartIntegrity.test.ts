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
  stockOf,
  cartLines,
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

const add = (token: string, bookId: string, quantity: number, storeId?: string) =>
  call(token, "POST", "/cart", { bookId, quantity, storeId });

describe("switching a cart line between stock sources", () => {
  it("store A -> store B releases A's reservation and reserves at B", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    let s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 1);

    const res = await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
    assert.equal(res.status, 200);

    s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 0, "store A must be released");
    assert.equal(s.b.reserved, 2, "store B holds the whole line (1 carried over + 1 added)");
    assert.equal(s.legacy.reserved, 0);

    const lines = await cartLines(fx.customer1.id);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].store_id, fx.storeB);
    assert.equal(lines[0].quantity, 2);
    assert.equal(Number(lines[0].store_price), 350, "price snapshot is store B's price");
    assert.equal(res.body.items[0].storeId, fx.storeB);
  });

  it("legacy inventory -> store inventory releases the legacy hold", async () => {
    await add(fx.customer1.token, fx.bookId, 2);
    assert.equal((await stockOf(fx.bookId, fx.storeA, fx.storeB)).legacy.reserved, 2);

    const res = await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    assert.equal(res.status, 200);

    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.legacy.reserved, 0, "legacy stock must be released, not leaked");
    assert.equal(s.a.reserved, 3);
    const lines = await cartLines(fx.customer1.id);
    assert.equal(lines[0].store_id, fx.storeA);
    assert.equal(lines[0].quantity, 3);
    assert.equal(Number(lines[0].store_price), 318);
  });

  it("store inventory -> legacy inventory releases the store hold and clears the store fields", async () => {
    await add(fx.customer1.token, fx.bookId, 2, fx.storeA);

    const res = await add(fx.customer1.token, fx.bookId, 1);
    assert.equal(res.status, 200);

    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 0, "store A must be released");
    assert.equal(s.legacy.reserved, 3);
    const lines = await cartLines(fx.customer1.id);
    assert.equal(lines[0].store_id, null, "line must no longer point at the store");
    assert.equal(lines[0].store_price, null);
    assert.equal(lines[0].quantity, 3);
    assert.equal(res.body.items[0].unitPrice, 300, "legacy price comes from the book");
  });

  it("insufficient stock at the new source changes nothing", async () => {
    await add(fx.customer1.token, fx.bookId, 3, fx.storeA); // A: 3 reserved
    // Moving 3 + 1 = 4 copies to store B, which only has 3.
    const res = await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
    assert.equal(res.status, 409);

    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 3, "old reservation must be kept");
    assert.equal(s.b.reserved, 0);
    const lines = await cartLines(fx.customer1.id);
    assert.equal(lines[0].store_id, fx.storeA);
    assert.equal(lines[0].quantity, 3);
  });

  it("insufficient legacy stock when switching store -> legacy changes nothing", async () => {
    await pool.query("UPDATE inventory SET quantity = 1 WHERE book_id = $1", [fx.bookId]);
    await add(fx.customer1.token, fx.bookId, 2, fx.storeA);
    const res = await add(fx.customer1.token, fx.bookId, 1);
    assert.equal(res.status, 409);
    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 2);
    assert.equal(s.legacy.reserved, 0);
  });

  it("rolls everything back when the cart update fails part-way", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    // Make UPDATE cart_items blow up AFTER the old reservation has been released.
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_cart_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated cart update failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_cart_update BEFORE UPDATE ON cart_items
      FOR EACH ROW EXECUTE FUNCTION test_fail_cart_update();`);
    try {
      const res = await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
      assert.equal(res.status, 500);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS test_fail_cart_update ON cart_items");
    }

    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.equal(s.a.reserved, 1, "A's reservation must be restored by the rollback");
    assert.equal(s.b.reserved, 0, "B must not keep a reservation");
    const lines = await cartLines(fx.customer1.id);
    assert.equal(lines[0].store_id, fx.storeA);
    assert.equal(lines[0].quantity, 1);

    // And the cart still works normally afterwards.
    const again = await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
    assert.equal(again.status, 200);
  });

  it("two customers racing for the last copy: exactly one wins, no oversell", async () => {
    await pool.query("UPDATE store_book_inventory SET quantity = 1 WHERE store_id = $1 AND book_id = $2", [fx.storeA, fx.bookId]);
    const [r1, r2] = await Promise.all([
      add(fx.customer1.token, fx.bookId, 1, fx.storeA),
      add(fx.customer2.token, fx.bookId, 1, fx.storeA),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.equal((await stockOf(fx.bookId, fx.storeA, fx.storeB)).a.reserved, 1);
  });

  it("removing and clearing release the right source after a switch", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
    await call(fx.customer1.token, "DELETE", `/cart/${fx.bookId}`);
    let s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.deepEqual([s.a.reserved, s.b.reserved, s.legacy.reserved], [0, 0, 0]);

    await add(fx.customer1.token, fx.bookId, 2);
    await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
    await call(fx.customer1.token, "DELETE", "/cart");
    s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.deepEqual([s.a.reserved, s.b.reserved, s.legacy.reserved], [0, 0, 0]);
  });
});

describe("price-safe checkout", () => {
  const raisePrice = (storeId: string, bookId: string, price: number) =>
    pool.query("UPDATE store_book_inventory SET price = $1 WHERE store_id = $2 AND book_id = $3", [price, storeId, bookId]);
  const checkout = (token: string, extra: object = {}) =>
    call(token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai", ...extra });

  it("unchanged price: checkout works exactly as before (no confirmation needed)", async () => {
    await add(fx.customer1.token, fx.bookId, 2, fx.storeA);
    const res = await checkout(fx.customer1.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.order.total, 636);
    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.deepEqual([s.a.quantity, s.a.reserved], [1, 0]);
    assert.equal((await cartLines(fx.customer1.id)).length, 0);
  });

  it("price changed after add-to-cart: checkout is refused with the updated price, nothing is charged", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA); // shown ₹318
    await raisePrice(fx.storeA, fx.bookId, 818);

    const cart = await call(fx.customer1.token, "GET", "/cart");
    assert.equal(cart.body.items[0].priceChanged, true);
    assert.equal(cart.body.items[0].unitPrice, 318);
    assert.equal(cart.body.items[0].currentPrice, 818);

    const res = await checkout(fx.customer1.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "PRICE_CHANGED");
    assert.equal(res.body.priceChanges.length, 1);
    assert.equal(res.body.priceChanges[0].previousPrice, 318);
    assert.equal(res.body.priceChanges[0].currentPrice, 818);
    assert.equal(res.body.priceChanges[0].storeId, fx.storeA);
    assert.equal(res.body.previousTotal, 318);
    assert.equal(res.body.newTotal, 818);

    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 0, "no order created");
    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.deepEqual([s.a.quantity, s.a.reserved], [3, 1], "stock and reservation untouched");
    assert.equal((await cartLines(fx.customer1.id)).length, 1, "cart kept");
  });

  it("a price DROP also needs confirmation (never silently charge a different amount)", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    await raisePrice(fx.storeA, fx.bookId, 250);
    const res = await checkout(fx.customer1.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.newTotal, 250);
  });

  it("customer confirms the updated price and checkout succeeds at that price", async () => {
    await add(fx.customer1.token, fx.bookId, 2, fx.storeA);
    await raisePrice(fx.storeA, fx.bookId, 818);

    const first = await checkout(fx.customer1.token);
    assert.equal(first.status, 409);

    const confirmed = first.body.priceChanges.map((c: any) => ({
      bookId: c.bookId,
      storeId: c.storeId,
      unitPrice: c.currentPrice,
    }));
    const res = await checkout(fx.customer1.token, { confirmedPrices: confirmed });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.total, 1636);

    const item = (await pool.query("SELECT unit_price, store_id, quantity FROM order_items")).rows[0];
    assert.equal(Number(item.unit_price), 818);
    assert.equal(item.store_id, fx.storeA);
    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.deepEqual([s.a.quantity, s.a.reserved], [1, 0]);
    assert.equal((await cartLines(fx.customer1.id)).length, 0);
  });

  it("a confirmation for an out-of-date price is rejected if the price moved again", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    await raisePrice(fx.storeA, fx.bookId, 818);
    const first = await checkout(fx.customer1.token);
    await raisePrice(fx.storeA, fx.bookId, 900); // moved again after the customer reviewed 818
    const res = await checkout(fx.customer1.token, {
      confirmedPrices: [{ bookId: fx.bookId, storeId: fx.storeA, unitPrice: first.body.priceChanges[0].currentPrice }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.priceChanges[0].currentPrice, 900);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 0);
  });

  it("malformed confirmedPrices is a 422, not a 500", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    const res = await checkout(fx.customer1.token, { confirmedPrices: [{ bookId: "nope" }] });
    assert.equal(res.status, 422);
  });

  it("top-up from the same store does not silently re-price the existing line", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    await raisePrice(fx.storeA, fx.bookId, 818);
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    const lines = await cartLines(fx.customer1.id);
    assert.equal(Number(lines[0].store_price), 318, "shown price is kept until the customer confirms");
    assert.equal((await checkout(fx.customer1.token)).status, 409);
  });
});

describe("legacy inventory checkout still works", () => {
  it("legacy cart line checks out, deducts legacy stock and shows in order history", async () => {
    await add(fx.customer1.token, fx.bookId, 2);
    const res = await call(fx.customer1.token, "POST", "/orders/checkout", {
      shippingAddress: "12 Test Street, Chennai",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.total, 600);

    const s = await stockOf(fx.bookId, fx.storeA, fx.storeB);
    assert.deepEqual([s.legacy.quantity, s.legacy.reserved], [3, 0]);
    assert.deepEqual([s.a.reserved, s.b.reserved], [0, 0]);
    const item = (await pool.query("SELECT unit_price, store_id FROM order_items")).rows[0];
    assert.equal(Number(item.unit_price), 300);
    assert.equal(item.store_id, null);

    const history = await call(fx.customer1.token, "GET", "/orders");
    assert.equal(history.body.orders.length, 1);
    const detail = await call(fx.customer1.token, "GET", `/orders/${res.body.order.id}`);
    assert.equal(detail.body.order.items[0].unitPrice, 300);
  });

  it("mixed cart (one legacy line, one store line) checks out in one order", async () => {
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    await add(fx.customer1.token, fx.book2Id, 1);
    const res = await call(fx.customer1.token, "POST", "/orders/checkout", {
      shippingAddress: "12 Test Street, Chennai",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.total, 618);
  });

  it("a second checkout of an already-emptied cart is rejected", async () => {
    await add(fx.customer1.token, fx.bookId, 1);
    const body = { shippingAddress: "12 Test Street, Chennai" };
    const [a, b] = await Promise.all([
      call(fx.customer1.token, "POST", "/orders/checkout", body),
      call(fx.customer1.token, "POST", "/orders/checkout", body),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 400]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 1);
  });
});

describe("cache invalidation after stock changes", { skip: !hasRedis && "set TEST_REDIS_URL to run" }, () => {
  it("clears book list, book detail and store-listing caches when a cart line moves", async () => {
    const keys = [`books:list:test`, `book:detail:${fx.bookId}`, `book:store-listings:${fx.bookId}`];
    const prime = async () => {
      for (const k of keys) await redisClient.set(k, "stale");
    };
    const present = async () => (await Promise.all(keys.map((k) => redisClient.exists(k)))).reduce((a, b) => a + b, 0);

    await prime();
    await add(fx.customer1.token, fx.bookId, 1, fx.storeA);
    assert.equal(await present(), 0, "add to cart");

    await prime();
    await add(fx.customer1.token, fx.bookId, 1, fx.storeB); // switch
    assert.equal(await present(), 0, "switch store");

    await prime();
    await call(fx.customer1.token, "PATCH", `/cart/${fx.bookId}`, { action: "decrease" });
    assert.equal(await present(), 0, "decrease");

    await prime();
    await call(fx.customer1.token, "POST", "/orders/checkout", { shippingAddress: "12 Test Street, Chennai" });
    assert.equal(await present(), 0, "checkout");

    await add(fx.customer1.token, fx.bookId, 1, fx.storeB);
    await prime();
    await call(fx.customer1.token, "DELETE", "/cart");
    assert.equal(await present(), 0, "clear cart");
  });
});

describe("first cart creation under concurrency (Task 6 regression)", () => {
  it("many simultaneous first-time cart lookups for a new customer all succeed and share one cart", async () => {
    // Before the fix, concurrent SELECT-then-INSERT hit the UNIQUE(user_id) constraint and the losers failed.
    const { getOrCreateCartId } = await import("../src/controllers/cartController");
    for (let round = 0; round < 5; round++) {
      const f = await resetAndSeed();
      const results = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const c = await pool.connect();
          try {
            await c.query("BEGIN");
            const id = await getOrCreateCartId(f.customer1.id, c);
            await c.query("COMMIT");
            return id;
          } catch (err) {
            await c.query("ROLLBACK");
            throw err;
          } finally {
            c.release();
          }
        })
      );
      assert.equal(new Set(results).size, 1, "every request must see the same cart id");
      const rows = await pool.query("SELECT COUNT(*)::int AS n FROM cart WHERE user_id = $1", [f.customer1.id]);
      assert.equal(rows.rows[0].n, 1);
    }
  });
});

describe("review changes clear the cached book rating (Task 6 regression)", { skip: !hasRedis && "set TEST_REDIS_URL to run" }, () => {
  it("posting a review and an admin deleting it both clear the book list and detail caches", async () => {
    const { createUserWithToken } = await import("./helpers");
    const admin = await createUserWithToken("Review Admin", "admin");
    const keys = [`books:list:test`, `book:detail:${fx.bookId}`];
    const prime = async () => {
      for (const k of keys) await redisClient.set(k, "stale");
    };
    const present = async () => (await Promise.all(keys.map((k) => redisClient.exists(k)))).reduce((a, b) => a + b, 0);

    await prime();
    const created = await call(fx.customer1.token, "POST", `/books/${fx.bookId}/reviews`, { rating: 5, comment: "Great" });
    assert.equal(created.status, 201);
    assert.equal(await present(), 0, "after posting a review");

    await prime();
    const del = await call(admin.token, "DELETE", `/admin/reviews/${created.body.review.id}`);
    assert.equal(del.status, 204);
    assert.equal(await present(), 0, "after an admin deletes the review");
  });
});
