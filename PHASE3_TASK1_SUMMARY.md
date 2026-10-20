# BookNest – Phase 3, Task 1: Cart integrity and price-safe checkout

Status: **DONE – awaiting your approval. Not committed, not pushed. No migration added.**
Next planned task: Task 2 (order lifecycle: allowed status transitions, cancel restores stock, id validation).

## Files changed
Server
- `server/src/controllers/cartController.ts` – reservation switching, cart row lock, helpers, price fields in cart response, cache invalidation
- `server/src/controllers/orderController.ts` – price check + confirmation at checkout, cart lock, deadlock-safe lock order, cache invalidation
- `server/src/utils/cache.ts` – new `invalidateAvailabilityCaches(bookIds)`
- `server/package.json` – new `test` script (no new dependency)
- `server/.env.example` – documented `TEST_DATABASE_URL` / `TEST_REDIS_URL` (comments only)
- NEW `server/tests/helpers.ts`, `server/tests/cartIntegrity.test.ts`, `server/tests/tsconfig.json`
Client
- `client/src/api/client.ts` – `ApiError` now keeps the JSON body (`data`)
- `client/src/context/CartContext.tsx` – optional `currentPrice`, `priceChanged`, `hasPriceChanges` types
- `client/src/pages/CartPage.tsx` – "Price changed ₹x → ₹y" badge on a line
- `client/src/pages/CheckoutPage.tsx` – shows the price review box, then "Confirm new price" button
Not touched: order cancellation, store-owner orders, book requests, nearby stores, migrations, schema.

## Root causes
1. **Reservation leak.** `cart_items` allows one row per book. Adding the same book from another source reused that row and overwrote `store_id`, but only the NEW source was reserved; the OLD source's `reserved` was never released. The legacy branch also never cleared `store_id`/`store_price`, so store -> legacy left a line pointing at the store (and charging the store price) while holding legacy stock.
2. **Silent price change.** The cart showed the price saved when the item was added (`cart_items.store_price`), but checkout charged the listing's price at checkout time and never compared the two. Same-store "add again" also silently overwrote the saved price.
3. (Found while fixing) Checkout locked stock rows in cart order, so two carts with the same books in opposite order could deadlock. Cart helpers used the pool (a second connection) inside transactions.

## How the fixes work
- **Switching source** (`POST /api/cart`): in one transaction – lock the user's cart row, lock the cart line, lock BOTH stock rows in a fixed order (legacy first, then stores by id), check the new source can cover the WHOLE line (existing qty + requested), then release the old reservation, reserve at the new source, and update `store_id`/`store_price` (set to NULL for legacy). Any failure -> ROLLBACK, cart and stock unchanged. Same-source add still just tops up.
  - Design decision: switching moves the whole line (e.g. 1 from A + add 1 from B = 2 from B). If B can't cover 2, you get 409 and nothing changes.
- **Price safety** (`POST /api/orders/checkout`): for each store line, compare the saved price with the listing price (in paise). If different and not confirmed -> HTTP 409, `{ code: "PRICE_CHANGED", priceChanges: [{bookId,title,storeId,storeName,quantity,previousPrice,currentPrice}], previousTotal, newTotal }`. Nothing is written. The customer reviews, then re-submits with `confirmedPrices: [{bookId, storeId, unitPrice}]`. The confirmation must equal the CURRENT price, so if the price moves again the customer gets a new 409. A price drop also needs confirmation. Unchanged prices need no extra field (old flow intact). Bad `confirmedPrices` -> 422.
- `GET /api/cart` now also returns per-line `currentPrice`/`priceChanged` and `hasPriceChanges`; line `unitPrice` is still the price the customer saw.
- **Locks/transactions:** cart row `FOR UPDATE` first in add/+/−/remove/clear/checkout (serialises one customer's requests, so a double-click checkout gives 201 + 400), then cart lines, then stock rows (`ORDER BY book_id` in checkout and clear). Raw `pg`, no ORM.
- **Cache:** after COMMIT, add/+/−/remove/clear/checkout call `invalidateAvailabilityCaches` which clears `books:list:*`, `book:detail:<id>` and `book:store-listings:<id>`. Redis errors are swallowed as before.

## Tests run (actual results)
Environment: throwaway PostgreSQL 16 + Redis in the sandbox (never your database).
- `tsc --noEmit` server: pass. Tests tsconfig: pass. Client `tsc -b`: pass.
- `npm run test --workspace=server` (Node built-in runner via ts-node): **19 tests, 19 pass, 0 fail** (ran twice, same result).
- Same tests against your ORIGINAL cart/order code: 12 fail, 6 pass (+1 skipped, no Redis) – so the tests really catch the bugs; legacy-checkout tests pass on both old and new code.
- Covered: A->B switch, legacy->store, store->legacy, insufficient stock at new source (store target and legacy target), price change, confirm-and-succeed, drop needs confirmation, stale confirmation rejected again, bad payload 422, same-store top-up keeps shown price, rollback via a DB trigger that fails mid-update, two customers racing for the last copy, remove/clear after switch, legacy checkout + order history, mixed cart, double-click checkout, cache invalidation (needs Redis).
- To run yourself: create an empty DB named e.g. `booknest_test`, then
  `TEST_DATABASE_URL=postgres://user:pass@localhost:5432/booknest_test npm run test --workspace=server`
  (add `TEST_REDIS_URL=redis://localhost:6379` for the cache test). The tests refuse to run unless the DB name contains "test", and they wipe its tables.

## NOT verified / remaining risks
- **Client `vite build` was NOT run**: the uploaded `node_modules` are Windows binaries and the sandbox cannot download the Linux ones. Client was checked with `tsc -b` only. Please run `npm run build:client` locally. The checkout price-review screen was not tried in a browser.
- Legacy lines have no saved price (no column; adding one needs a migration), so legacy price is read live from `books.price`. Not changed.
- Reservations still never expire (abandoned carts hold stock) – later task.
- Admin legacy `updateInventory` can set quantity below `reserved` – not touched.
- Cancelling an order still doesn't restore stock – Task 2.
- Cache invalidation uses Redis `KEYS` (existing pattern) – fine for a college project, slow on huge key sets.
- The first run of the test DB needs migrations; the test helper applies them to the test DB only.
- The zip excludes `node_modules`, `dist` folders and `server/.env` (run `npm install`; keep your own `.env`).
