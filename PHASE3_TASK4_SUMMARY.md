# BookNest – Phase 3, Task 4: Project hardening

Status: **IMPLEMENTED – NOT YET RUN. Awaiting your review. Not committed, not pushed. No migration added. No dependency added. Task 5 NOT started.**

## READ THIS FIRST: what was and was not verified
The sandbox this was built in had **no network access** (npm and apt both failed with `ENOTFOUND`), so there was no PostgreSQL, no Redis, no `node_modules`.
That means:

| Check | Result |
|---|---|
| Server tests (`npm run test --workspace=server`) | **NOT RUN** |
| `tsc` type check – server | **NOT RUN** (no `@types/*` packages available) |
| `tsc` type check – client / tests | **NOT RUN** |
| Client production build (`npm run build --workspace=client`) | **NOT RUN** |
| Anything in a browser | **NOT TESTED** |
| Syntax check of all 25 changed/new `.ts`/`.tsx` files (TypeScript parser, no type resolution) | **Passed – 0 syntax errors** |
| Line-by-line review of every code path against the tests I wrote | Done by reading only |

Please run these on your machine before trusting this task (commands at the bottom). If anything fails, send me the output and I'll fix it.
Nothing was run against your real database. The new tests use the same `TEST_DATABASE_URL` guard as before (database name must contain "test").

## Base copy
The zip contained Tasks 1 and 3 (no `PHASE3_TASK2_SUMMARY.md`, no Task 2 code). Task 2's order-status code is not in this copy and was not touched
(finding E6, `updateOrderStatus` has no ID check, is still open for that reason). Everything from Tasks 1 and 3 is preserved; only the files listed below differ from the zip you sent.

## Your decisions, as implemented
1. **Rate limiting** – custom limiter, Redis with in-memory fallback, no new dependency: `server/src/utils/loginRateLimiter.ts`.
   Counts failed logins only, in three fixed 15-minute windows that start at the first failure and are never extended, so a block always ends by itself:
   - per IP + normalized email: 5 failures → blocked (stops guessing one account)
   - per IP: 20 failures → blocked (stops spraying many accounts)
   - per email, any IP: 50 failures → blocked (backstop against distributed guessing; deliberately high so a stranger can't easily lock you out of your own account)
   A successful login clears the IP+email and email counters (the per-IP counter is left to expire so a valid account can't be used to reset it).
   Blocked → `429`, `Retry-After` header, "Too many failed login attempts. Please try again in N minutes." If a Redis call fails, that call falls back to memory.
2. **Role re-check** – `requireAuth` now loads the user from the database on every authenticated request. Deleted user → 401. Role and email come from the database, so a demoted admin gets 403 immediately and a promoted user is recognised without a new token. Token lifetime unchanged (7 days).
3. **Book deletion** – `DELETE /api/books/:id` returns **409** if any order line, cart line or store listing references the book, naming which ones, and deletes nothing. The book row (and its legacy stock row) is locked first so a cart line can't be added between the check and the delete. Legacy stock, reviews and second-hand condition rows still go with a book that is deletable, as before.
4. **Dashboard** – legacy (catalog) and store inventory are separate figures with separate low-stock lists; see API change below.
5. **Store activity** – `stores.is_active = false` is enforced in cart and checkout; see below.

## Other fixes
- **JWT secret**: server refuses to start (exit 1) and `signToken` refuses to sign if `JWT_SECRET` is missing, shorter than 32 characters, or a known placeholder (outside `NODE_ENV=test`). Error text never contains the secret. Algorithm pinned to HS256 for signing and verifying; payload (UUID `userId`, `email`, known `role`) validated. Cookie lifetime now follows `JWT_EXPIRES_IN` (default 7d).
- **Dummy bcrypt compare** for unknown emails (a real hash of the same cost, computed once).
- **Error handler**: `23503` → 409, `23514`/`22P02`/`23502`/`22003`/`22001` → 422, `23505` → 409; malformed JSON → 400; oversized body → 413. Messages are fixed strings (no table/constraint/value text). In production only `{name, code, message}` is logged, never the stack or raw object.
- **Category IDs** are integers (`PUT/DELETE /categories/:id` used to reject every id as "not a UUID").
- **Book validation** (create and update): `categoryId` must be a whole number that exists (422 otherwise), quantity must be a non-negative whole number if sent (it used to be silently ignored when invalid on update), ISBN must be 10 or 13 characters (hyphens/spaces ignored; stored without them; checksum NOT enforced so existing data keeps saving), title ≤ 255 and author ≤ 160 characters.
- **Quantity can't go below reserved**: admin `PATCH /books/:id/inventory`, admin `PUT /books/:id` (the whole edit rolls back on refusal) and store-owner `PATCH /stores/inventory/:bookId`. The rule is inside the `UPDATE ... WHERE reserved <= new_quantity`, so it is evaluated atomically against the row's committed `reserved` – a reservation can't slip in between a check and a write. The store-owner update also now changes only the fields sent (`COALESCE`), so it can't overwrite a concurrent change to another field. `isActive` must be a real boolean.
- **Legacy checkout short on stock** → `409 Only N copies of "X" are in stock now…` instead of a database error; nothing is written.
- **Cache**: deleting a book now clears `book:store-listings:<id>`; `updateStore` clears all store-listings caches.
- **Lock ordering**: delete/edit book take the legacy stock row before the book row, the same order cart and checkout already use, so they can't deadlock with each other.
- **Client**: new `fetchAllBooks()` in `client/src/api/client.ts` walks every page (server caps a page at 50); used by Admin Books, Admin Inventory and the store-owner book picker. Admin Books shows the server's deletion message (`"Title": This book can't be deleted because…`) and scrolls it into view. Cart page flags lines from inactive stores and disables checkout until they're removed. Dashboard shows the separate figures.
- **Config**: `docker-compose.yml` now requires `JWT_SECRET` (compose refuses to start without it, with a hint) and passes `JWT_EXPIRES_IN`/`NODE_ENV`; `server/.env.example` updated with how to generate a secret and the optional `TRUST_PROXY`.

## API changes you should know about
- `GET /api/admin/dashboard`: **`availableInventory` removed** (it was ambiguous). New: `legacyAvailableInventory`, `storeAvailableInventory`, `lowStockStoreListings[]` (`bookId, title, author, storeId, storeName, availableQuantity`). `lowStockBooks` is unchanged in shape and means *catalog* stock. Low-stock = **available** copies (quantity − reserved, floored at 0) ≤ 5. Store figures count only active listings in active stores (what customers can actually buy).
- `GET /api/cart` items gain `storeActive` (false when the line's store is inactive).
- Inactive store: add-to-cart and "+" return `409 This store is not currently accepting orders.`; checkout returns `409 <Store> is not currently accepting orders. Remove "<title>"…` and changes nothing. "−", remove, clear, and moving the line to another source still work. Order history, order lines and inventory rows are untouched. There is still no endpoint that sets `stores.is_active = false`; it is enforced for when one exists (or you set it in the database).
- `DELETE /api/books/:id` can now return 409 (see above).

## Files changed
Server – `utils/jwt.ts`, `utils/password.ts`, `utils/validation.ts`, `utils/cache.ts`, NEW `utils/loginRateLimiter.ts`, `middleware/auth.ts`, `middleware/errorHandler.ts`, `controllers/authController.ts`, `bookController.ts`, `categoryController.ts`, `cartController.ts`, `orderController.ts`, `storeController.ts`, `storeInventoryController.ts`, `adminController.ts`, `index.ts`
Tests – `tests/helpers.ts` (sets `NODE_ENV=test`, mounts auth/books/categories/admin routes), NEW `tests/hardening.test.ts`
Client – `api/client.ts`, `pages/admin/AdminBooks.tsx`, `AdminInventory.tsx`, `AdminDashboard.tsx`, `components/StoreInventoryPanel.tsx`, `context/CartContext.tsx`, `pages/CartPage.tsx`
Config – `docker-compose.yml`, `server/.env.example`, this file

## Tests written (`server/tests/hardening.test.ts`, ~70 tests, not yet run)
JWT config (missing/short/placeholder secret, startup exit via a child process, cookie lifetime) · token verification (wrong algorithm, `none`, bad payloads, garbage) · deleted/demoted/promoted users · login (cookie, identical 401s, dummy hash) · rate limiting (5/20/50 limits, expiry, success clears, normalised email, other accounts and other IPs unaffected, memory path, Redis path when `TEST_REDIS_URL` set) · error handler (malformed JSON, DB code mapping with no leaks, production logging) · book/category/ISBN/quantity validation · deletion blocked by orders / carts / store listings / all three, deletable book still deletes, delete-vs-add-to-cart race · below-reserved refusal (admin, book edit rollback, store owner) · concurrent reservation-vs-quantity-cut races (legacy and store) · legacy checkout 409 · inactive store (add, checkout, +/−/remove, switch away, history preserved) · dashboard figures · pagination walk over 122 books · cache invalidation on book delete and store update (Redis tests skip without `TEST_REDIS_URL`).

## Limitations and things that remain
- **Everything above is unrun** – see the table at the top.
- The client `fetchAllBooks()` loop is only covered indirectly: the server test checks the page contract it depends on (cap of 50, stable order, every book reachable); the client helper itself has no automated test and has not been tried in a browser.
- `AdminSecondHand.tsx` still loads `limit=50` (same pagination limit, not in your list). Easy follow-up using `fetchAllBooks`.
- Register still says "An account with that email already exists" (email enumeration via registration) and has no rate limit; you asked for login only.
- Behind a proxy, set `TRUST_PROXY` (e.g. `1`) or every user shares one IP in the limiter. It is not defaulted on because that would let clients spoof `X-Forwarded-For`.
- The in-memory fallback is per server process; with several server instances and Redis down, each counts separately.
- Concurrent logins can overshoot a limit by a request or two (check-then-record, not atomic).
- Deleting a book still silently removes its reviews, legacy stock row and second-hand condition (you only asked to protect orders, carts and store listings).
- Task 2's order-status ID validation (E6) isn't in this copy.
- Existing deployments must now set `JWT_SECRET` (32+ characters). A server started with the old placeholder will refuse to boot – that is intended.

## Run it
```
# throwaway DB whose name contains "test"; TEST_REDIS_URL is optional (enables the Redis/cache tests)
set TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/booknest_test
npm install
npm run test --workspace=server
npx tsc -p server/tsconfig.json --noEmit
npx tsc -p server/tests/tsconfig.json
npm run build --workspace=client
```
