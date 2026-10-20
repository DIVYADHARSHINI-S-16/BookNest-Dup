# Phase 3, Task 2: Order Lifecycle and Cancellation (on top of Tasks 1, 3, 4, 5)

## Verification status (read first)
The sandbox has no npm network access and no PostgreSQL or Redis, so **none of these were run**:
`npm install`, `npm test`, `npx tsc --noEmit`, `npm run build:server`, `npm run build:client`, the migration against a database, or the new/existing integration tests.

What was run: a syntax-only transpile of every `.ts`/`.tsx` file in the project (0 diagnostics), and `tsx` on the pure transition table in `utils/orderLifecycle.ts` (output matches the table below). These are not substitutes for type checks or tests. The 23 new tests in `server/tests/orderLifecycle.test.ts` have never executed; expect possible failures on first run.

## What was found in the repository
- `PATCH /api/orders/:id/status` (admin) accepted any status in any order, did not validate the id, and setting `CANCELLED` did **not** restore stock.
- No customer cancel endpoint existed.
- Stock lives in two places: `store_book_inventory` (lines with `order_items.store_id`) and legacy `inventory` (lines with `store_id IS NULL`). Checkout decrements `quantity` and releases `reserved` in the matching table.
- Store owners (Task 3) have read-only order access. That is unchanged: an order can span several stores and has a single status, so one store changing it would affect the others.

## Status transition rules (administrator, `PATCH /api/orders/:id/status`)
| From | Allowed next |
|---|---|
| PLACED | CONFIRMED, CANCELLED |
| CONFIRMED | PACKED, CANCELLED |
| PACKED | SHIPPED |
| SHIPPED | DELIVERED |
| DELIVERED | (final) |
| CANCELLED | (final) |

Anything else (skipping, going backwards, repeating the same status, leaving a final status) returns **409**. Bad id: 400. Unknown order: 404. Invalid status value: 422. Invalid `?status=` filter on the admin list: 400. Customers can cancel only PLACED or CONFIRMED orders (`POST /api/orders/:id/cancel`); an admin cancels through the same transition rules.

## Endpoints
- `POST /api/orders/:id/cancel`: customer, own order only (400 bad id, 403 not yours, 404 unknown, 409 not cancellable/already cancelled).
- `PATCH /api/orders/:id/status`: admin only (existing path, now validated and lifecycle-aware).
- Responses additively gain `canCancel` and `cancelledAt`; admin responses also gain `allowedNextStatuses`. Existing fields are unchanged.

## Cancellation / stock-restoration design
One shared function, `cancelOrderInTransaction` (`server/src/utils/orderLifecycle.ts`), used by both entry points:
1. `BEGIN`; lock the order row with `SELECT ... FOR UPDATE`.
2. Check ownership (customer path) and that the status allows the move.
3. `UPDATE orders SET status='CANCELLED', cancelled_at, stock_restored_at, payment_status='MOCK_REFUNDED' WHERE id=$1 AND status IN ('PLACED','CONFIRMED') AND stock_restored_at IS NULL`. If that touches no row, abort with 409. This is the exactly-once guard on top of the row lock.
4. Aggregate the order's lines by (book, store), ordered by `book_id` then `store_id` (the same lock order checkout uses, to avoid deadlocks), and add the quantity back: store lines to `store_book_inventory.quantity`, NULL-store lines to `inventory.quantity`. `reserved` is not changed (checkout already released it).
5. `COMMIT`. Any error triggers `ROLLBACK`, which undoes the status change and every stock change together.
6. After commit, clear availability caches for the affected books.

Edge case: if a stock row no longer exists (listing or inventory row deleted), that line cannot be restored; the cancel still succeeds and the response reports `unrestoredLines`. Orders already CANCELLED before this migration have `stock_restored_at = NULL` and are final; their stock is not guessed at.

## Migration
`server/src/db/migrations_phase3t2.sql` (registered in `migrate.ts` and test `helpers.ts`, after the Task 5 migration). Adds `orders.cancelled_at`, `orders.stock_restored_at` and a CHECK that `stock_restored_at` is only set on CANCELLED orders. Idempotent. Apply with `npm run db:migrate`.

## Files
Added: `server/src/utils/orderLifecycle.ts`, `server/src/db/migrations_phase3t2.sql`, `server/tests/orderLifecycle.test.ts`, `client/src/components/orderStatus.ts`, this file.
Modified: `server/src/controllers/orderController.ts`, `server/src/routes/orderRoutes.ts`, `server/src/db/migrate.ts`, `server/tests/helpers.ts` (migration list), `client/src/pages/OrdersPage.tsx`, `client/src/pages/OrderDetailPage.tsx` (Cancel order button, shown only when `canCancel`), `client/src/pages/admin/AdminOrders.tsx` and `AdminOrderDetail.tsx` (status dropdown limited to allowed transitions, confirmation before cancelling), `client/src/components/StoreOrdersPanel.tsx` (shared status badges).
No existing tests were removed or weakened. Checkout, cart, Task 3 store orders and Task 5 book-request code were not changed.

## Tests added (`server/tests/orderLifecycle.test.ts`, 23 tests, NOT YET RUN)
Valid and invalid transitions; invalid ids and status values; admin-only status changes; customer ownership; store owners refused; successful multi-store cancellation restoring store A, store B and legacy stock; no cancel after PACKED/SHIPPED/DELIVERED; repeated cancel restores once; concurrent cancels (customer + admin) restore once; two orders cancelled concurrently; deleted-listing handling; pre-existing CANCELLED orders; rollback via an injected failing trigger on both cancel paths; the DB CHECK; checkout regression; Book Request regression.

## How to verify
```
npm install
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/booknest_test
npm run db:migrate
npm test --workspace=server
npx tsc -p server/tsconfig.json --noEmit
npm run build:server
npm run build:client
```

## Remaining issues
- Nothing above has been executed; see "Verification status".
- `MOCK_REFUNDED` is a new `payment_status` value set on cancel (the column has no CHECK constraint).
- Store owners still cannot change order status (design decision above).
- Nearby-store discovery and other features were intentionally not touched.
