# Phase 3, Task 5: Book Request Management

Isolated change on top of `latest021220_phase3_task4.zip`. Task 2 (order lifecycle / stock restoration) is **not** present and was **not** recreated or merged.

## Verification status (read first)
The sandbox had no network access to npm and no PostgreSQL or Redis, so **none of the following were run**:
- `npm install`, `npm test`, `npm run build:server`, `npm run build:client`, backend/frontend type checks
- the migration against a real database; the new integration tests (`server/tests/bookRequests.test.ts`)

What was actually run: a syntax-only transpile of every new/changed `.ts`/`.tsx` file (0 diagnostics) and a runtime check of the pure validation helpers (`utils/bookRequests.ts`) with `tsx`. These are **not** substitutes for the type checks and tests above. Please run the commands in "How to verify" before relying on this change.

## Implemented
- **Customer** (`/book-requests`, role `customer`): create, list own (paginated, status filter), view, cancel. Customers see status plus response and offer **counts** only: no store names, store notes or admin notes.
- **Store owner** (`/stores/book-requests`): list open requests (optional `responded=true|false`), create a response, edit own response. Inactive stores get 403; a store with no record gets 404. Owners never see customer identity, other stores' responses or admin notes.
- **Admin** (`/admin/book-requests`): list (status filter, text search, pagination), view with all store responses and notes, update status and/or private admin notes.
- No dashboard card was added.

## Rules
- Open statuses: `PENDING`, `SUPPLIER_FOUND` (one constant, `OPEN_STATUSES`, used by limits, duplicate checks, cancellation and store eligibility).
- Max 10 open requests per customer (429); max 5 new requests per rolling 24h counted over all statuses, so cancelling does not reset the window (429).
- Duplicates (409), per customer and only among open requests: same normalized ISBN; or, with no ISBN, same normalized (NFKC, trimmed, whitespace-collapsed, lower-cased) title + author. An ISBN already in `books` is rejected (409).
- Admin workflow: `PENDING -> SUPPLIER_FOUND | UNAVAILABLE | CANCELLED`; `SUPPLIER_FOUND -> PENDING | FULFILLED | UNAVAILABLE | CANCELLED`; `FULFILLED`, `UNAVAILABLE`, `CANCELLED` are final (409 otherwise).
- Customer cancel: open requests only. A store response never changes the request status automatically; only an admin does.
- Concurrency: the customer row is locked (`SELECT ... FOR UPDATE`) during creation so counts can't be raced; partial unique indexes back up the duplicate rules; `UNIQUE (request_id, store_id)` plus `ON CONFLICT DO NOTHING` blocks duplicate responses; the request row is locked `FOR SHARE` when responding and `FOR UPDATE` when cancelling or changing status, so no response lands on a request that just closed.
- Caching: these endpoints do not use Redis, so there is nothing to invalidate and no private data is cached.

## Migration
`server/src/db/migrations_phase3t5.sql` (registered in `migrate.ts` and test `helpers.ts`). Creates only `book_requests` and `book_request_responses`; idempotent; no existing table or data is touched.
Apply: `npm run db:migrate`

## Endpoints
| Method & path | Access |
|---|---|
| POST `/api/book-requests` | customer |
| GET `/api/book-requests` | customer (own) |
| GET `/api/book-requests/:id` | customer (own, else 404) |
| POST `/api/book-requests/:id/cancel` | customer (own, open only) |
| GET `/api/stores/book-requests` | active store owner |
| POST `/api/stores/book-requests/:requestId/response` | active store owner (first response; 409 if one exists) |
| PUT `/api/stores/book-requests/:requestId/response` | active store owner (own response, open request) |
| GET `/api/admin/book-requests` | admin |
| GET `/api/admin/book-requests/:id` | admin |
| PATCH `/api/admin/book-requests/:id` (`status`, `adminNotes`) | admin |

## Files
Added: `server/src/db/migrations_phase3t5.sql`, `server/src/utils/bookRequests.ts`, `server/src/controllers/{bookRequestController,storeBookRequestController,adminBookRequestController}.ts`, `server/src/routes/bookRequestRoutes.ts`, `server/tests/bookRequests.test.ts`, `client/src/pages/BookRequestsPage.tsx`, `client/src/pages/admin/AdminBookRequests.tsx`, `client/src/components/StoreBookRequestsPanel.tsx`, `client/src/components/bookRequestShared.ts`, this file.
Modified (small additive edits): `server/src/db/migrate.ts`, `server/src/index.ts`, `server/src/routes/storeRoutes.ts`, `server/src/routes/adminRoutes.ts`, `server/tests/helpers.ts` (migration list, routes, TRUNCATE list), `client/src/main.tsx`, `client/src/components/Navbar.tsx`, `client/src/components/admin/AdminLayout.tsx`, `client/src/pages/StoreOwnerPage.tsx`.

## Frontend
Customer "Request a Book" page at `/book-requests` (navbar link, customers only); a "Customer book requests" panel on the store-owner page (shown only for an active store); an admin "Book Requests" page at `/admin/book-requests` (sidebar link). They reuse existing layouts, StateBlocks, toasts and CSS classes.

## How to verify
```
npm install
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/booknest_test   # name must contain "test"
npm run db:migrate
npm test --workspace=server
npx tsc -p server/tsconfig.json --noEmit
npm run build:server
npm run build:client
```

## Known issues / remaining work
- Everything under "Verification status" is unrun; expect the possibility of type errors or failing tests on first run.
- Duplicate checks are per customer (a different customer can request the same book); this is a design choice, adjust if you want global de-duplication.
- Existing tests that TRUNCATE tables now also truncate the two new tables via the shared helper.
- Task 2 is not included.
