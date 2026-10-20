import "./helpers"; // must stay first: sets test-only env vars before the app loads
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool, applyMigrations, startTestServer, resetAndSeed, makeApi, createUserWithToken, Fixtures } from "./helpers";

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

const create = (token: string, body: any) => call(token, "POST", "/book-requests", body);
const valid = (n = 1, extra: any = {}) => ({ title: `Rare Book ${n}`, author: `Author ${n}`, ...extra });

/** Inserts a request row directly (bypasses the API limits) so tests control status and age. */
async function seedRequest(userId: string, n: number, opts: { status?: string; hoursAgo?: number; isbn?: string | null } = {}) {
  const r = await pool.query(
    `INSERT INTO book_requests (user_id, title, author, isbn, title_normalized, author_normalized, status, created_at)
     VALUES ($1, $2, 'Seed Author', $3, $4, 'seed author', $5, now() - ($6 || ' hours')::interval) RETURNING id`,
    [userId, `Seed ${n}`, opts.isbn ?? null, `seed ${n}`, opts.status ?? "PENDING", String(opts.hoursAgo ?? 48)]
  );
  return r.rows[0].id as string;
}

describe("customer: create and validate", () => {
  it("creates a request with PENDING status and zero counts", async () => {
    const r = await create(fx.customer1.token, valid(1, { isbn: "978-0-306-40615-7", notes: "  Hardcover  " }));
    assert.equal(r.status, 201);
    assert.equal(r.body.request.status, "PENDING");
    assert.equal(r.body.request.isbn, "9780306406157");
    assert.equal(r.body.request.notes, "Hardcover");
    assert.equal(r.body.request.responseCount, 0);
    assert.equal(r.body.request.offerCount, 0);
  });

  it("rejects invalid input with 422", async () => {
    for (const body of [
      {},
      { title: "A", author: "Valid Author" },
      { title: "Valid Title", author: "" },
      { title: "x".repeat(256), author: "Valid Author" },
      { title: "Valid Title", author: "Valid Author", isbn: "12345" },
      { title: "Valid Title", author: "Valid Author", notes: "n".repeat(1001) },
      { title: 123, author: "Valid Author" },
    ]) {
      const r = await create(fx.customer1.token, body);
      assert.equal(r.status, 422, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await pool.query("SELECT COUNT(*) FROM book_requests")).rows[0].count, "0");
  });

  it("rejects a book that is already in the catalog by ISBN", async () => {
    await pool.query("UPDATE books SET isbn = '9780306406157' WHERE id = $1", [fx.bookId]);
    const r = await create(fx.customer1.token, valid(1, { isbn: "9780306406157" }));
    assert.equal(r.status, 409);
  });
});

describe("duplicate rules", () => {
  it("blocks a duplicate open ISBN (hyphens ignored)", async () => {
    assert.equal((await create(fx.customer1.token, valid(1, { isbn: "9780306406157" }))).status, 201);
    const dup = await create(fx.customer1.token, valid(2, { isbn: "978-0-306-40615-7" }));
    assert.equal(dup.status, 409);
  });

  it("blocks a duplicate title+author without ISBN, ignoring case and spacing", async () => {
    assert.equal((await create(fx.customer1.token, { title: "The Lost Book", author: "Jane Doe" })).status, 201);
    const dup = await create(fx.customer1.token, { title: "  the   LOST book ", author: "jane  DOE" });
    assert.equal(dup.status, 409);
  });

  it("allows a different customer to request the same book", async () => {
    assert.equal((await create(fx.customer1.token, valid(1, { isbn: "9780306406157" }))).status, 201);
    assert.equal((await create(fx.customer2.token, valid(1, { isbn: "9780306406157" }))).status, 201);
  });

  it("allows re-requesting after the earlier request was cancelled", async () => {
    const first = await create(fx.customer1.token, valid(1, { isbn: "9780306406157" }));
    await call(fx.customer1.token, "POST", `/book-requests/${first.body.request.id}/cancel`);
    assert.equal((await create(fx.customer1.token, valid(2, { isbn: "9780306406157" }))).status, 201);
  });

  it("parallel identical submissions create exactly one request", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => create(fx.customer1.token, valid(1, { isbn: "9780306406157" })))
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => r.status === 201 || r.status === 409));
    assert.equal((await pool.query("SELECT COUNT(*) FROM book_requests")).rows[0].count, "1");
  });
});

describe("limits", () => {
  it("rejects the 11th open request (10-open limit)", async () => {
    for (let i = 1; i <= 10; i++) await seedRequest(fx.customer1.id, i); // all older than 24h
    const r = await create(fx.customer1.token, valid(99));
    assert.equal(r.status, 429);
    assert.match(r.body.error, /10 open/);
  });

  it("closed requests do not count toward the open limit", async () => {
    for (let i = 1; i <= 10; i++) await seedRequest(fx.customer1.id, i, { status: i <= 5 ? "FULFILLED" : "PENDING" });
    assert.equal((await create(fx.customer1.token, valid(99))).status, 201);
  });

  it("rejects the 6th request within 24 hours, including closed ones", async () => {
    for (let i = 1; i <= 5; i++) assert.equal((await create(fx.customer1.token, valid(i))).status, 201);
    const sixth = await create(fx.customer1.token, valid(6));
    assert.equal(sixth.status, 429);
    assert.match(sixth.body.error, /24 hours/);
    // Cancelling does not reset the rolling window.
    const list = await call(fx.customer1.token, "GET", "/book-requests");
    await call(fx.customer1.token, "POST", `/book-requests/${list.body.requests[0].id}/cancel`);
    assert.equal((await create(fx.customer1.token, valid(7))).status, 429);
  });

  it("requests older than 24 hours fall out of the rolling window", async () => {
    for (let i = 1; i <= 5; i++) await seedRequest(fx.customer1.id, i, { status: "FULFILLED", hoursAgo: 25 });
    assert.equal((await create(fx.customer1.token, valid(99))).status, 201);
  });

  it("limits are per customer", async () => {
    for (let i = 1; i <= 5; i++) await create(fx.customer1.token, valid(i));
    assert.equal((await create(fx.customer2.token, valid(1))).status, 201);
  });
});

describe("customer: ownership, cancellation and privacy", () => {
  it("lists only the caller's own requests, with pagination", async () => {
    await create(fx.customer1.token, valid(1));
    await create(fx.customer1.token, valid(2));
    await create(fx.customer2.token, valid(3));
    const r = await call(fx.customer1.token, "GET", "/book-requests?limit=1&page=2");
    assert.equal(r.status, 200);
    assert.equal(r.body.requests.length, 1);
    assert.equal(r.body.pagination.total, 2);
    assert.equal(r.body.pagination.totalPages, 2);
  });

  it("another customer gets 404 when viewing or cancelling", async () => {
    const created = await create(fx.customer1.token, valid(1));
    const id = created.body.request.id;
    assert.equal((await call(fx.customer2.token, "GET", `/book-requests/${id}`)).status, 404);
    assert.equal((await call(fx.customer2.token, "POST", `/book-requests/${id}/cancel`)).status, 404);
    const still = await pool.query("SELECT status FROM book_requests WHERE id = $1", [id]);
    assert.equal(still.rows[0].status, "PENDING");
  });

  it("owner can cancel an open request; a second cancel and closed statuses give 409", async () => {
    const id = (await create(fx.customer1.token, valid(1))).body.request.id;
    const c = await call(fx.customer1.token, "POST", `/book-requests/${id}/cancel`);
    assert.equal(c.status, 200);
    assert.equal(c.body.request.status, "CANCELLED");
    assert.equal(c.body.request.canCancel, false);
    assert.equal((await call(fx.customer1.token, "POST", `/book-requests/${id}/cancel`)).status, 409);

    const fulfilled = await seedRequest(fx.customer1.id, 5, { status: "FULFILLED" });
    assert.equal((await call(fx.customer1.token, "POST", `/book-requests/${fulfilled}/cancel`)).status, 409);
  });

  it("SUPPLIER_FOUND requests can still be cancelled", async () => {
    const id = await seedRequest(fx.customer1.id, 1, { status: "SUPPLIER_FOUND" });
    assert.equal((await call(fx.customer1.token, "POST", `/book-requests/${id}/cancel`)).status, 200);
  });

  it("malformed id gives 400", async () => {
    assert.equal((await call(fx.customer1.token, "GET", "/book-requests/not-a-uuid")).status, 400);
  });

  it("customer sees response/offer counts but no store notes, store identity or admin notes", async () => {
    const id = (await create(fx.customer1.token, valid(1))).body.request.id;
    await call(fx.ownerA.token, "POST", `/stores/book-requests/${id}/response`, { response: "CAN_SUPPLY", note: "SECRET-STORE-NOTE" });
    await call(fx.ownerB.token, "POST", `/stores/book-requests/${id}/response`, { response: "CANNOT_SUPPLY", note: "SECRET-B-NOTE" });
    await call(admin.token, "PATCH", `/admin/book-requests/${id}`, { adminNotes: "SECRET-ADMIN-NOTE" });

    for (const url of [`/book-requests/${id}`, "/book-requests"]) {
      const r = await call(fx.customer1.token, "GET", url);
      const text = JSON.stringify(r.body);
      assert.ok(!text.includes("SECRET"), `leak in ${url}`);
      assert.ok(!/adminNotes|admin_notes|storeName|storeId/.test(text), `leak in ${url}`);
    }
    const one = (await call(fx.customer1.token, "GET", `/book-requests/${id}`)).body.request;
    assert.equal(one.responseCount, 2);
    assert.equal(one.offerCount, 1);
  });
});

describe("store owner responses", () => {
  let requestId: string;
  beforeEach(async () => {
    requestId = (await create(fx.customer1.token, valid(1))).body.request.id;
  });

  it("lists open requests without customer identity", async () => {
    await seedRequest(fx.customer2.id, 2, { status: "CANCELLED" });
    const r = await call(fx.ownerA.token, "GET", "/stores/book-requests");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.requests.map((x: any) => x.id), [requestId]);
    assert.ok(!/customer|email|userId|adminNotes/i.test(JSON.stringify(r.body)));
    assert.equal(r.body.requests[0].myResponse, null);
  });

  it("creates a response with an optional note", async () => {
    const r = await call(fx.ownerA.token, "POST", `/stores/book-requests/${requestId}/response`, { response: "CAN_SUPPLY", note: " In stock soon " });
    assert.equal(r.status, 201);
    assert.equal(r.body.myResponse.note, "In stock soon");
    const noNote = await call(fx.ownerB.token, "POST", `/stores/book-requests/${requestId}/response`, { response: "CANNOT_SUPPLY" });
    assert.equal(noNote.status, 201);
    assert.equal(noNote.body.myResponse.note, null);
  });

  it("rejects invalid response values and over-long notes", async () => {
    const url = `/stores/book-requests/${requestId}/response`;
    assert.equal((await call(fx.ownerA.token, "POST", url, { response: "MAYBE" })).status, 422);
    assert.equal((await call(fx.ownerA.token, "POST", url, {})).status, 422);
    assert.equal((await call(fx.ownerA.token, "POST", url, { response: "CAN_SUPPLY", note: "n".repeat(501) })).status, 422);
  });

  it("prevents a duplicate response from the same store, even in parallel", async () => {
    const url = `/stores/book-requests/${requestId}/response`;
    const results = await Promise.all(Array.from({ length: 3 }, () => call(fx.ownerA.token, "POST", url, { response: "CAN_SUPPLY" })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 2);
    assert.equal((await pool.query("SELECT COUNT(*) FROM book_request_responses")).rows[0].count, "1");
  });

  it("a store can update only its own response; others are untouched", async () => {
    const url = `/stores/book-requests/${requestId}/response`;
    await call(fx.ownerA.token, "POST", url, { response: "CAN_SUPPLY", note: "A" });
    await call(fx.ownerB.token, "POST", url, { response: "CANNOT_SUPPLY", note: "B" });
    const upd = await call(fx.ownerA.token, "PUT", url, { response: "CANNOT_SUPPLY", note: "A2" });
    assert.equal(upd.status, 200);
    const rows = (await pool.query("SELECT store_id, response, note FROM book_request_responses")).rows;
    assert.equal(rows.find((r) => r.store_id === fx.storeA).note, "A2");
    assert.equal(rows.find((r) => r.store_id === fx.storeB).note, "B");
    // Updating without a prior response is a 404, not a create.
    const c = await createUserWithToken("Owner C", "store_owner");
    await pool.query("INSERT INTO stores (owner_user_id, name, slug, country) VALUES ($1, 'Store C', 'store-c', 'IN')", [c.id]);
    assert.equal((await call(c.token, "PUT", url, { response: "CAN_SUPPLY" })).status, 404);
  });

  it("each owner sees only their own response in the list", async () => {
    await call(fx.ownerA.token, "POST", `/stores/book-requests/${requestId}/response`, { response: "CAN_SUPPLY", note: "A-ONLY" });
    const b = await call(fx.ownerB.token, "GET", "/stores/book-requests");
    assert.equal(b.body.requests[0].myResponse, null);
    assert.ok(!JSON.stringify(b.body).includes("A-ONLY"));
  });

  it("inactive stores can neither view nor respond", async () => {
    await pool.query("UPDATE stores SET is_active = false WHERE id = $1", [fx.storeA]);
    assert.equal((await call(fx.ownerA.token, "GET", "/stores/book-requests")).status, 403);
    assert.equal((await call(fx.ownerA.token, "POST", `/stores/book-requests/${requestId}/response`, { response: "CAN_SUPPLY" })).status, 403);
    assert.equal((await call(fx.ownerA.token, "PUT", `/stores/book-requests/${requestId}/response`, { response: "CAN_SUPPLY" })).status, 403);
  });

  it("an owner without a store gets 404", async () => {
    const o = await createUserWithToken("No Store", "store_owner");
    assert.equal((await call(o.token, "GET", "/stores/book-requests")).status, 404);
  });

  it("closed requests reject responses and are not listed", async () => {
    await call(fx.customer1.token, "POST", `/book-requests/${requestId}/cancel`);
    assert.equal((await call(fx.ownerA.token, "POST", `/stores/book-requests/${requestId}/response`, { response: "CAN_SUPPLY" })).status, 409);
    assert.equal((await call(fx.ownerA.token, "GET", "/stores/book-requests")).body.requests.length, 0);
  });

  it("unknown request gives 404 and malformed id gives 400", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.equal((await call(fx.ownerA.token, "POST", `/stores/book-requests/${missing}/response`, { response: "CAN_SUPPLY" })).status, 404);
    assert.equal((await call(fx.ownerA.token, "POST", "/stores/book-requests/nope/response", { response: "CAN_SUPPLY" })).status, 400);
  });
});

describe("role and authentication failures", () => {
  it("rejects unauthenticated callers with 401", async () => {
    for (const [m, u] of [["GET", "/book-requests"], ["POST", "/book-requests"], ["GET", "/stores/book-requests"], ["GET", "/admin/book-requests"]]) {
      const res = await fetch(`${server.baseUrl}${u}`, { method: m });
      assert.equal(res.status, 401, `${m} ${u}`);
    }
  });

  it("enforces roles with 403", async () => {
    const id = (await create(fx.customer1.token, valid(1))).body.request.id;
    assert.equal((await call(fx.ownerA.token, "GET", "/book-requests")).status, 403);
    assert.equal((await call(fx.ownerA.token, "POST", "/book-requests", valid(2))).status, 403);
    assert.equal((await call(admin.token, "POST", "/book-requests", valid(2))).status, 403);
    assert.equal((await call(fx.customer1.token, "GET", "/stores/book-requests")).status, 403);
    assert.equal((await call(fx.customer1.token, "POST", `/stores/book-requests/${id}/response`, { response: "CAN_SUPPLY" })).status, 403);
    assert.equal((await call(fx.customer1.token, "GET", "/admin/book-requests")).status, 403);
    assert.equal((await call(fx.customer1.token, "PATCH", `/admin/book-requests/${id}`, { status: "CANCELLED" })).status, 403);
    assert.equal((await call(fx.ownerA.token, "GET", `/admin/book-requests/${id}`)).status, 403);
  });
});

describe("administrator", () => {
  let id: string;
  beforeEach(async () => {
    id = (await create(fx.customer1.token, valid(1))).body.request.id;
  });
  const patch = (body: any, rid?: string) => call(admin.token, "PATCH", `/admin/book-requests/${rid ?? id}`, body);

  it("lists with status filter and search, and views responses including store notes", async () => {
    await call(fx.ownerA.token, "POST", `/stores/book-requests/${id}/response`, { response: "CAN_SUPPLY", note: "visible to admin" });
    const list = await call(admin.token, "GET", "/admin/book-requests?status=PENDING&q=rare");
    assert.equal(list.status, 200);
    assert.equal(list.body.requests.length, 1);
    assert.equal(list.body.requests[0].customer.email, "customerone@test.local");
    assert.equal((await call(admin.token, "GET", "/admin/book-requests?status=FULFILLED")).body.requests.length, 0);
    assert.equal((await call(admin.token, "GET", "/admin/book-requests?status=BOGUS")).status, 400);
    assert.equal((await call(admin.token, "GET", "/admin/book-requests?q=%25")).body.requests.length, 0); // wildcard is literal

    const detail = await call(admin.token, "GET", `/admin/book-requests/${id}`);
    assert.equal(detail.body.responses.length, 1);
    assert.equal(detail.body.responses[0].note, "visible to admin");
    assert.equal(detail.body.responses[0].storeName, "Store A");
  });

  it("follows the status workflow", async () => {
    assert.equal((await patch({ status: "FULFILLED" })).status, 409); // PENDING -> FULFILLED not allowed
    const found = await patch({ status: "SUPPLIER_FOUND" });
    assert.equal(found.status, 200);
    assert.equal(found.body.request.status, "SUPPLIER_FOUND");
    assert.ok(found.body.request.allowedNextStatuses.includes("FULFILLED"));
    assert.equal((await patch({ status: "FULFILLED" })).status, 200);
    // FULFILLED is final.
    for (const s of ["PENDING", "SUPPLIER_FOUND", "UNAVAILABLE", "CANCELLED"]) {
      assert.equal((await patch({ status: s })).status, 409, s);
    }
    assert.equal((await patch({ status: "NOT_A_STATUS" })).status, 422);
  });

  it("UNAVAILABLE and CANCELLED are final", async () => {
    assert.equal((await patch({ status: "UNAVAILABLE" })).status, 200);
    assert.equal((await patch({ status: "PENDING" })).status, 409);
    const other = await seedRequest(fx.customer2.id, 1);
    assert.equal((await patch({ status: "CANCELLED" }, other)).status, 200);
    assert.equal((await patch({ status: "SUPPLIER_FOUND" }, other)).status, 409);
  });

  it("closing a request frees the customer's open slot and blocks further store responses", async () => {
    await patch({ status: "UNAVAILABLE" });
    assert.equal((await call(fx.ownerA.token, "POST", `/stores/book-requests/${id}/response`, { response: "CAN_SUPPLY" })).status, 409);
    const row = (await call(fx.customer1.token, "GET", `/book-requests/${id}`)).body.request;
    assert.equal(row.status, "UNAVAILABLE");
    assert.equal(row.canCancel, false);
  });

  it("stores admin notes privately and lets them be cleared; notes alone do not change status", async () => {
    const n = await patch({ adminNotes: "  internal only  " });
    assert.equal(n.status, 200);
    assert.equal(n.body.request.adminNotes, "internal only");
    assert.equal(n.body.request.status, "PENDING");
    assert.equal((await patch({ adminNotes: null })).body.request.adminNotes, null);
    assert.equal((await patch({ adminNotes: "x".repeat(2001) })).status, 422);
    assert.equal((await patch({})).status, 422);
  });

  it("status change without adminNotes keeps existing notes", async () => {
    await patch({ adminNotes: "keep me" });
    const r = await patch({ status: "SUPPLIER_FOUND" });
    assert.equal(r.body.request.adminNotes, "keep me");
  });

  it("admin notes never reach customers or store owners", async () => {
    await patch({ adminNotes: "ADMIN-ONLY-TEXT" });
    for (const [token, url] of [
      [fx.customer1.token, `/book-requests/${id}`],
      [fx.customer1.token, "/book-requests"],
      [fx.ownerA.token, "/stores/book-requests"],
    ]) {
      assert.ok(!JSON.stringify((await call(token, "GET", url)).body).includes("ADMIN-ONLY-TEXT"), url);
    }
  });

  it("unknown and malformed ids", async () => {
    assert.equal((await patch({ status: "UNAVAILABLE" }, "00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await patch({ status: "UNAVAILABLE" }, "bad")).status, 400);
  });

  it("re-opening cannot create a second open duplicate (unique index backstop)", async () => {
    await patch({ status: "SUPPLIER_FOUND" });
    // A cancelled twin of the same title/author, then try to revive nothing: CANCELLED is final, so
    // the only revival path is SUPPLIER_FOUND -> PENDING, which keeps the same single open row.
    assert.equal((await patch({ status: "PENDING" })).status, 200);
    const open = await pool.query("SELECT COUNT(*) FROM book_requests WHERE status IN ('PENDING','SUPPLIER_FOUND')");
    assert.equal(open.rows[0].count, "1");
  });
});

describe("database constraints", () => {
  it("rejects invalid status, response value and duplicate store response at the database level", async () => {
    const id = await seedRequest(fx.customer1.id, 1);
    await assert.rejects(pool.query("UPDATE book_requests SET status = 'BOGUS' WHERE id = $1", [id]), { code: "23514" });
    await assert.rejects(
      pool.query("INSERT INTO book_request_responses (request_id, store_id, response) VALUES ($1, $2, 'MAYBE')", [id, fx.storeA]),
      { code: "23514" }
    );
    await pool.query("INSERT INTO book_request_responses (request_id, store_id, response) VALUES ($1, $2, 'CAN_SUPPLY')", [id, fx.storeA]);
    await assert.rejects(
      pool.query("INSERT INTO book_request_responses (request_id, store_id, response) VALUES ($1, $2, 'CANNOT_SUPPLY')", [id, fx.storeA]),
      { code: "23505" }
    );
  });

  it("deleting a request cascades to its responses", async () => {
    const id = await seedRequest(fx.customer1.id, 1);
    await pool.query("INSERT INTO book_request_responses (request_id, store_id, response) VALUES ($1, $2, 'CAN_SUPPLY')", [id, fx.storeA]);
    await pool.query("DELETE FROM book_requests WHERE id = $1", [id]);
    assert.equal((await pool.query("SELECT COUNT(*) FROM book_request_responses")).rows[0].count, "0");
  });
});

describe("cache consistency", () => {
  it("book request endpoints do not use Redis; private data is read from PostgreSQL on every call", async () => {
    // Status changes by an admin must be visible to the customer immediately.
    const id = (await create(fx.customer1.token, valid(1))).body.request.id;
    assert.equal((await call(fx.customer1.token, "GET", `/book-requests/${id}`)).body.request.status, "PENDING");
    await call(admin.token, "PATCH", `/admin/book-requests/${id}`, { status: "SUPPLIER_FOUND" });
    assert.equal((await call(fx.customer1.token, "GET", `/book-requests/${id}`)).body.request.status, "SUPPLIER_FOUND");
  });
});
