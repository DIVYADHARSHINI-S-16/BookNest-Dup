# BookNest – Phase 3, Task 3: Store-owner order visibility (read-only)

Status: **DONE – awaiting your review. Not committed, not pushed. No migration added. Task 4 NOT started.**

> Note: the zip I received (`latest021220_phase3_task1.zip`) contained Task 1 only (19 tests). The Task 2 changes were not in it,
> so Task 3 was built and tested on top of Task 1. Task 3 touches none of the Task 2 areas (cancel/status), so it should merge cleanly,
> but run the full suite after combining with your Task 2 copy.

## Files changed
Server
- NEW `server/src/controllers/storeOrderController.ts` – `getMyStoreOrders`, `getMyStoreOrderById`
- `server/src/routes/storeRoutes.ts` – two new GET routes (`/orders`, `/orders/:orderId`), `requireAuth` + `requireRole("store_owner")`
- `server/tests/helpers.ts` – mounts store routes in the test app; adds `ownerA`/`ownerB` fixtures, `createUserWithToken`, `createOrder`
- NEW `server/tests/storeOrders.test.ts` – 16 tests
Client
- NEW `client/src/components/StoreOrdersPanel.tsx`
- `client/src/pages/StoreOwnerPage.tsx` – renders the panel under the inventory panel (only when the owner has a store)
Not touched: checkout, cart, cancellation, order status, book requests, nearby stores, schema, migrations, Task 1 code.

## API
`GET /api/stores/orders?page=1&limit=10` (limit default 10, max 50; bad values are clamped, like the books list)
```
{ orders: [{ id, status, createdAt,
             customer: { name, shippingAddress },
             items: [{ id, bookId, title, author, quantity, unitPrice, lineTotal }],
             storeTotal }],
  pagination: { page, limit, total, totalPages } }
```
`GET /api/stores/orders/:orderId` -> `{ order }` (same shape). Errors: 400 malformed id, 401 anonymous, 403 not a store owner,
404 owner has no store ("You need to create your store…"), 404 "Order not found." when the order has none of the owner's items
(identical response for another store's order and a non-existent one). Responses send `Cache-Control: no-store`.

## How it is kept safe
- The store is looked up from the logged-in user id only; no store id is accepted from the client.
- Every query filters `order_items.store_id` = the owner's store, so mixed orders show only that store's lines and `storeTotal`;
  legacy lines (`store_id IS NULL`) and other stores' lines never match.
- Only customer name + the order's shipping address are returned. No email, user id, payment fields, or whole-order totals.
- Pagination is per order (an order with 2 lines counts once); newest first; uses existing indexes (`order_items.store_id`, `order_id`).
- Money is computed in SQL NUMERIC; unit price is the price recorded on the order line, not the current listing price.
- Read-only: no writes, no transactions needed.

## Root cause / why this task existed
Orders already record the selling store (`order_items.store_id`) but every orders route was customer- or admin-only, so store
owners had no way to see what to ship.

## Tests (actual results, sandbox: PostgreSQL 16 + Redis, throwaway DB `booknest_test`)
- `npm run build --workspace=server`: pass. Tests tsconfig `tsc --noEmit`: pass.
- `npm run test --workspace=server`: **35 tests, 35 pass, 0 fail** (19 from Task 1 + 16 new). Without Redis: 34/34 (cache test is skipped).
- Client `tsc -b`: pass. **`npm run build:client` (vite): pass** (73 modules).
- Mutation check: with the `store_id` filter temporarily removed, 5 of the new tests failed (then restored), so the tests do catch scoping bugs.
- New tests cover: A vs B isolation, mixed-store order (+ legacy line hidden, whole-order total hidden), empty owner, legacy-only orders
  invisible, recorded vs current price, CANCELLED shown, detail 404 identical for other-store/non-existent, malformed ids -> 400,
  anonymous 401 / customer 403 / admin 403 (list + detail), owner without store -> 404, write methods not exposed, email/userId/payment
  never in the response, `no-store` header, pagination (order, counts, beyond-range, clamping), and a real checkout -> owner sees it
  while a legacy-only checkout stays invisible.

## NOT verified
- The Orders panel was **not opened in a browser** (no browser in the sandbox); only type-check + production build were run.
- Not run against your real database or Task 2 code.

## Remaining risks
- Orders whose `order_items.store_id` was nulled (store deleted, `ON DELETE SET NULL`) are invisible to every owner.
- One status per order: an owner cannot mark only their part shipped (needs a migration; deliberately not done).
- Customer name + address are exposed to every store with a line in the order – intended, but a privacy-sensitive surface.
- `OFFSET` pagination is fine for college-scale data; very deep pages would be slower.

To run: `npm install`, `npm run build --workspace=server`, `npm run build:client`,
`TEST_DATABASE_URL=postgres://user:pass@localhost:5432/booknest_test npm run test --workspace=server` (add `TEST_REDIS_URL` for the cache test).
