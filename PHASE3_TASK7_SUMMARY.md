# Phase 3, Task 7: Nearby Bookstore Discovery

## What was added
Customers can open **Nearby Bookstores** (navbar, `/nearby-stores`), find participating stores by their current location, by city / postal code / store name, or by typing coordinates, see each store's public address and distance, and open a store to see its in-stock books with the store's own price and quantity. Store owners can set an optional map location on their store form.

No location columns were added: `stores.address, city, state, postal_code, country, latitude, longitude` already existed (`migrations_phase1f.sql`) and are reused.

## Design decisions
- **Search is `POST /api/stores/nearby`, not GET.** The server logs every URL with `morgan("dev")`; coordinates in a query string would be written to logs. Request bodies are not logged. Verified against a real running server (0 occurrences of the submitted coordinates in its log).
- **Nothing about the customer's location is stored, cached, logged or echoed back.** Responses carry `Cache-Control: no-store`. Browser location lives in React state only (not URL, not localStorage).
- **Geolocation only on a button click.** If blocked/unavailable/timed out, the page shows a message and the manual city/postal-code search and manual-coordinates form remain.
- **No geocoding** was added (none existed; no undocumented third-party dependency). Owners enter coordinates manually, or press a button that fills them from the device they are using (they still have to save).
- **Haversine is computed in PostgreSQL** (parameterised SQL), after a latitude-band prefilter. Client-supplied distances are never used.
- **No Redis caching for the new endpoints**, so there is nothing new to invalidate. Existing behaviour is kept: updating a store still clears the `book:store-listings:*` caches (tested).

## Database migration: `server/src/db/migrations_phase3t7.sql`
Additive, idempotent, added to `migrate.ts` and the test helper.
1. `stores_latitude_range`, `stores_longitude_range`, `stores_coordinates_pair` CHECK constraints, added `NOT VALID`: enforced for every new/changed row, existing rows are not scanned, so a legacy bad value cannot make the migration fail (tested).
2. `idx_stores_active_latitude`: a partial **B-tree** index on `stores(latitude)` for active stores with coordinates. It is NOT a spatial index and no PostGIS is used. On the 15-row demo data PostgreSQL chooses a sequential scan (checked with EXPLAIN); the index only matters with many stores.

## API
| Endpoint | Access | Purpose |
|---|---|---|
| `POST /api/stores/nearby` | public | Body `{latitude?, longitude?, radiusKm?, query?, page?, limit?}`. Coordinates both-or-neither. `radiusKm` 1-500 (default 25). `limit` 1-50 (default 20). `query` max 100 chars. Returns `stores[]`, `pagination`, `search`. |
| `GET /api/stores/:storeId/books?search=&page=&limit=` | public | In-stock books of an ACTIVE store (store price, `quantity - reserved`). Inactive/unknown store: 404. |
| `PUT /api/stores`, `POST /api/stores` (existing) | store_owner, own store only | Now validate optional `latitude`/`longitude`. Customers get 403, anonymous 401. |

Modes of `/nearby`: with coordinates = active stores with valid coordinates inside the radius, nearest first; `query` only = text match on name/address/city/state/postal code; neither = browse all active stores A-Z. Stores without usable coordinates are never ranked, and are counted in `search.unlocatedStoreCount`.

Public store fields returned: `id, name, slug, description, address, city, state, postalCode, country, distanceKm, availableBookCount`. Never returned: owner id, store email, phone, raw store coordinates, timestamps.

Update semantics on `PUT /api/stores`: omit `latitude`/`longitude` = unchanged (existing clients keep working); send both empty = clear; a partial update merges with the stored pair; a result that would leave only one coordinate is a 422.

## Files
Added: `server/src/utils/geo.ts`, `server/src/controllers/storeDiscoveryController.ts`, `server/src/db/migrations_phase3t7.sql`, `server/tests/nearbyStores.test.ts`, `client/src/pages/NearbyBookstoresPage.tsx`, `client/src/pages/StoreBooksPage.tsx`, `client/src/styles/nearby.css`, this file.
Modified: `server/src/controllers/storeController.ts` (coordinate validation), `server/src/routes/storeRoutes.ts`, `server/src/db/migrate.ts`, `server/tests/helpers.ts` (migration list only), `client/src/main.tsx`, `client/src/components/Navbar.tsx`, `client/src/pages/StoreOwnerPage.tsx`.

## Configuring store locations
1. Run `npm run db:migrate` (additive; safe to repeat).
2. As a store owner open **My Store** > "Map location (optional)". Enter latitude/longitude (in Google Maps, right-click the shop and click the numbers), or press "Fill from this device's location" while at the shop, then **Update store**. Leave both blank to remove the location.
3. The seeded demo stores (`npm run db:seed`) already have coordinates.

## Verification actually run (Node 22, PostgreSQL 16 and Redis from Ubuntu packages, disposable DBs)
| Check | Result |
|---|---|
| Baseline before changes, `npm test --workspace=server` with Redis | 170 tests, 170 passed |
| After changes, with Redis | **257 tests, 257 passed, 0 failed, 0 skipped** (170 existing + 87 new) |
| After changes, without Redis | 249 tests, 248 passed, 0 failed, 1 skipped (the Redis-only cache group) |
| `npm run db:migrate` on a fresh DB, run twice | all 10 files applied both times |
| Migration over a DB already holding an out-of-range store row | succeeded; constraints recorded as not validated |
| `npm run db:seed` twice | OK (second run 0 new listings) |
| Server TS check, tests TS check, client TS check | 0 errors |
| `npm run build:server`, `npm run build:client` | both succeed |
| Real server boot (`dist/index.js`) + HTTP calls to both endpoints | correct results; 422 on bad input; `Cache-Control: no-store`; access log contained none of the submitted coordinates |

Commands: `export TEST_DATABASE_URL=postgres://<user>:<pw>@127.0.0.1:5432/booknest_test TEST_REDIS_URL=redis://127.0.0.1:6379` then `npm test --workspace=server`; `npx tsc -p tsconfig.json --noEmit` in `server/` and `client/`, `npx tsc -p tests/tsconfig.json --noEmit` in `server/`; `npm run build:server`; `npm run build:client`.

The new tests cover: coordinate validation, Haversine correctness (known distances, antimeridian, poles), SQL-vs-JS distance agreement, sorting, radius filtering (including a store off to the side so the exact distance test, not just the prefilter, is exercised; I confirmed by mutation that removing the radius filter or reversing the sort makes tests fail), missing and legacy-invalid coordinates, text search and wildcard/SQL-injection handling, parameter validation (27 cases), public-data privacy, owner-only location updates, DB constraints, migration idempotency, cache invalidation (Redis), and regression checks including discover > cart > checkout > cancel. All existing test files are unchanged and still pass.

## Known limitations / remaining work
- **The new React pages were type-checked and built but never opened in a browser.** Layout, responsiveness, and the real browser permission prompt / denial flow are untested. Please try them by hand.
- Distance is straight-line (great-circle), not travel distance; Earth is modelled as a sphere (error well under 1%).
- No geocoding: typing an address does not turn it into coordinates. Text search matches stored name/address/city/state/postal-code text only.
- No map view (list only). Radius is in km only.
- Public endpoints have no dedicated rate limiter and are not cached; every request queries PostgreSQL. Fine for the current size; revisit if traffic grows.
- Admins have no UI to edit a store's location (no admin store-edit endpoint exists).
- Tested on Ubuntu PostgreSQL/Redis, not the project's Docker images; `docker-compose` was not run. `npm audit` was not run or changed.
- Not claimed production-ready.
