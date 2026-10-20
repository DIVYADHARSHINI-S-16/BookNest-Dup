# Phase 3, Task 6: Full Integration Audit, Testing and Bug Fixes

Integration and verification only. No new product features were added.

## What was verified (actually executed)
Environment: Node 22, PostgreSQL 16.15 and Redis 7.0.15 (Ubuntu packages in a sandbox, not the Docker images), disposable database `booknest_test`. Your real database was never touched.

| Check | Result |
|---|---|
| `npm ci` | OK, lockfile unchanged |
| `npm run db:migrate` on a fresh test DB (run twice) | All 9 files applied both times |
| Migrations on a Phase-2-shaped DB with existing orders | OK; an already-cancelled order kept NULL cancel timestamps (stock not restored twice) |
| `npm test --workspace=server` with Redis | 170 tests: 170 passed, 0 failed, 0 skipped |
| `npm test --workspace=server` without Redis | 165 tests: 164 passed, 0 failed; 4 Redis-only groups (5 tests) skipped |
| Server TS check, tests TS check, client TS check | 0 errors |
| `npm run build:server`, `npm run build:client` | Both succeed |
| Real server boot (`dist/index.js`) | Rejects missing/short JWT_SECRET; health, login, catalog, role checks OK |
| `npm run db:seed` (twice) | OK, re-runnable |

Test files: cartIntegrity 21, orderLifecycle 23, storeOrders 16, hardening 67, bookRequests 43.

Migration order: Task 5 (`migrations_phase3t5.sql`, new tables) then Task 2 (`migrations_phase3t2.sql`, two columns on `orders`). They are independent and coexist; the order matches the Task 2 summary.

## Defects fixed
1. **Cart creation race** (`cartController.ts`): simultaneous first requests from a new customer hit the UNIQUE(user_id) constraint. Now `INSERT ... ON CONFLICT DO NOTHING` then re-read.
2. **Unprotected ROLLBACK** (cart, order, book, second-hand controllers): a failing ROLLBACK inside a catch block skipped `next(err)`. Added `.catch(() => undefined)`, matching the Task 2/4/5 code.
3. **Stale rating cache** (`reviewController.ts`): adding or deleting a review now clears book list/detail caches.
4. **Test helper** (`loginRateLimiter.ts`): `expireLoginLimiterMemory()` now also clears Redis counters (it is async; two call sites in `hardening.test.ts` now `await` it). Assertions unchanged.
5. **Role-specific access** (`RequireAuth.tsx`, `main.tsx`): `/cart`, `/checkout`, `/order-success`, `/orders`, `/book-requests` are customer-only; `/orders/:id` and `/profile` stay open to any logged-in user.

Tests added (none removed or weakened): concurrent first-cart creation; review changes clear cached rating (needs Redis). Both were confirmed to fail on the original code.

## Modified files
- server/src/controllers/cartController.ts, orderController.ts, bookController.ts, secondHandController.ts, reviewController.ts
- server/src/utils/loginRateLimiter.ts
- server/tests/cartIntegrity.test.ts, hardening.test.ts
- client/src/routes/RequireAuth.tsx, client/src/main.tsx
- PHASE3_TASK6_SUMMARY.md (this file)

## Still to do on your side
- Run `npm run db:migrate` on your real database (Task 5 then Task 2; additive and idempotent).
- To run tests: set `TEST_DATABASE_URL` (name must contain "test") and optionally `TEST_REDIS_URL`, then `npm test --workspace=server`.

## Known risks / unverified
- No real-browser testing or screenshots. Route guards were checked with a jsdom render only; the client type-checks and builds.
- Tested on Ubuntu PostgreSQL/Redis, not your Docker images; docker-compose was not run.
- Without Redis, login rate-limit counters are per server process.
- Checkout's Order Summary shows pre-change prices while a price-change confirmation is open (cosmetic).
- `npm audit`: 11 vulnerabilities (1 critical, 7 high, 3 moderate), 5 in production dependencies. Not changed.
- Orders whose store listing was later deleted cannot restore that line's stock; the API reports `unrestoredLines` (existing design).
