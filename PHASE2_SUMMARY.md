# BookNest — Phase 2 (Multi-Store Core) Summary

Hard rule from user: No git/GitHub commands — ever. All work is local file
edits only. This zip was produced by excluding `node_modules` and `.git`
to keep it small; run `npm install` in `client/` and `server/` after
extracting.

## Starting point (verified by inspection, not assumed)

The uploaded project already had, from earlier sessions:
- `stores` and `store_book_inventory` tables (`migrations_phase1f.sql`,
  constraint added in `migrations_phase2a.sql`)
- `store_owner` role wired into `users.role` check constraint and into
  `requireAuth`/`requireRole` middleware
- Basic store CRUD: `storeController.ts` (`createStore`, `updateStore`,
  `getMyStore`, `listStoresForAdmin`) + `storeRoutes.ts`
- `StoreOwnerPage.tsx` (store profile form only — no inventory UI yet)
- `RequireStoreOwner.tsx` route guard, already mounted in `main.tsx`
- `isValidUuid` already added to `validation.ts` and already used across
  book/cart controllers (so the "malformed ID → 500" gap from an earlier
  Phase was already fixed in this branch — good shape to build on)
- `invalidateBookCaches` / `getCache` / `setCache` / `deleteCacheByPrefix`
  helpers already in `utils/cache.ts`

What was missing, and what this session built: the inventory layer (store
owners could create a store but not list books in it), and the customer
side (no way to see or choose a store for a book).

## 1. Files changed

**New files**
- `server/src/db/migrations_phase2b.sql`
- `server/src/controllers/storeInventoryController.ts`
- `server/src/routes/storeInventoryRoutes.ts`
- `client/src/components/StoreInventoryPanel.tsx`

**Modified files**
- `server/src/db/migrate.ts` — registered the new migration file
- `server/src/controllers/storeController.ts` — added `getBookStoreListings`
- `server/src/routes/storeRoutes.ts` — mounted `/inventory` sub-router
- `server/src/routes/bookRoutes.ts` — mounted `GET /:bookId/store-listings`
- `server/src/controllers/cartController.ts` — `store_id`-aware
  add/increase/decrease/remove/clear, `loadCart` now returns `storeId`/`storeName`
- `server/src/controllers/orderController.ts` — checkout blocks store-sourced
  cart lines (see Limitations)
- `client/src/context/CartContext.tsx` — `addToCart` takes optional `storeId`;
  `CartItem` has `storeId`/`storeName`
- `client/src/pages/StoreOwnerPage.tsx` — renders `StoreInventoryPanel` once
  a store exists
- `client/src/pages/BookDetailPage.tsx` — new "Available at Stores" section
  (radio select + add-to-cart)
- `client/src/pages/CartPage.tsx` — shows "From {storeName}" badge on
  store-sourced lines
- `client/src/pages/CheckoutPage.tsx` — warns and disables Place Order when
  the cart has store-sourced lines

**Not touched**: `schema.sql`, the legacy `inventory` table, `books` table,
admin dashboard/books/inventory, reviews, auth, Redis config, second-hand
flow — all exactly as they were.

## 2. Database changes

`migrations_phase2b.sql` (additive, idempotent, non-destructive):
```sql
ALTER TABLE cart_items
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS store_price NUMERIC(10, 2);
CREATE INDEX IF NOT EXISTS idx_cart_items_store_id ON cart_items(store_id);
```
`cart_items` keeps its existing `UNIQUE (cart_id, book_id)` — one line per
book per cart, store_id just tags which listing it came from. No table
was duplicated, no book record duplicated, legacy `inventory` table is
completely unchanged.

**Run it**: `cd server && npx ts-node src/db/migrate.ts` (or however this
project normally runs migrations — check `package.json` scripts).

## 3. APIs added/modified

New (all under `requireAuth, requireRole("store_owner")` except the last):
- `GET /api/stores/inventory` — owner's own inventory
- `POST /api/stores/inventory` `{ bookId, price, quantity }`
- `PATCH /api/stores/inventory/:bookId` `{ price?, quantity?, isActive? }`
- `DELETE /api/stores/inventory/:bookId`
- `GET /api/books/:bookId/store-listings` — public, active + in-stock only

Modified:
- `POST /api/cart` now accepts optional `storeId`
- `POST /api/orders/checkout` now returns `400` if the cart contains any
  store-sourced line (see Limitations)

All ownership checks resolve the store from `req.user!.userId` server-side
— a store owner can never read/write another owner's inventory by guessing
IDs, regardless of what the frontend sends.

## 4. Frontend changes

- `StoreOwnerPage` → `StoreInventoryPanel`: table of the owner's listings
  (Book / Price / Quantity / Status / Actions), an Add Book form that picks
  from existing books only (no duplicate book creation), inline
  price/quantity edit with Save, Activate/Deactivate toggle, Remove
  (blocked server-side while reserved > 0, with a clear message to
  deactivate instead).
- `BookDetailPage` → "Available at Stores" section: radio list of active,
  in-stock store listings with price/qty, customer must select one before
  "Add selected store's listing to cart" is enabled. Existing title/author/
  description/rating/reviews/second-hand sections are untouched, just
  pushed down by this new section.
- `CartPage` / `CheckoutPage`: store-sourced lines are visibly labeled and
  checkout is blocked on them with an inline explanation (not a silent
  failure).

## 5. Store-owner workflow completed

Login as store_owner → create/have a store → open Store Inventory panel →
Add Book (select existing book, set price + quantity) → book now listed →
edit price/quantity inline → Save → Deactivate/Activate toggle → Remove
(when nothing reserved). All scoped to that owner's own store on the
backend.

## 6. Customer multi-store workflow completed

Customer opens a book → sees existing info (title/author/desc/rating/
reviews/second-hand) unchanged → sees new "Available at Stores" section
listing every active, in-stock store offering it, each with its own price
and quantity → selects one store via radio button → adds that specific
store's listing to the cart → cart shows the item tagged with the store
name and uses that store's price.

## 7. Tests performed

- `npx tsc --noEmit` on both `server` and `client` after every change —
  clean (no new errors; only pre-existing tsconfig deprecation warnings
  unrelated to this work).
- Static code review of every new/changed query against the actual
  `schema.sql` + `migrations_phase1f/2a/2b.sql` column names.

**Not performed this session** (ran out of time/turns): no live run against
a real Postgres/Redis instance, so none of the 20 scenarios in the original
task list (store owner login, two stores pricing the same book
differently, Owner A vs Owner B isolation, inactive/out-of-stock listing
behavior, actual cart→Redis invalidation, etc.) were exercised end-to-end
in a browser. Treat the "Tests performed" above as compile-time
verification only.

## 8. Build results

Both `server` and `client` type-check cleanly (`tsc --noEmit` exit code 0,
no errors attributable to this session's changes).

## 9. Limitations remaining for Phase 3

- **Store-aware checkout is not implemented.** Checkout currently rejects
  any cart containing a store-sourced line with a clear error, rather than
  guessing which stock table/price to charge. Phase 3 needs to: decide how
  an order splits across stores (or restricts to one store per order),
  deduct from `store_book_inventory` (not the legacy `inventory` table) for
  those lines, and decide what `order_items` should record about which
  store fulfilled each line (currently `order_items` has no store
  reference at all).
- Nothing from the explicitly-excluded Phase 3 list was touched: no nearby
  store search, no GPS/maps, no book request system, no owner accept/
  reject flow, no order splitting, no payment changes, no new analytics or
  recommendations.
- `AdminBookForm.tsx` still can't pre-resolve `categoryId` on edit (a
  pre-existing, separately-flagged issue — not part of this phase).

## Immediate next steps when resuming

1. Run the migration, start Postgres/Redis/server/client, and actually
   work through the 20-item test list from the original task prompt.
2. If anything fails, fix before moving to Phase 3 — don't layer Phase 3
   on top of unverified Phase 2 code.
3. Decide the Phase 3 approach to store-aware checkout/order splitting
   before writing any order code, since it changes `order_items` schema.
