# Phase 3, Task 13: Final database safety review

Baseline: Task 12 contents. Original ZIPs untouched. Static review only: no database was contacted (not Neon, not local, not a scratch instance), no migration/seed/admin SQL was executed, no Git, nothing deployed. Therefore "initializes an empty Neon database" is concluded from reading the SQL, **not** from running it.

## 1. SQL review
**Order (as run):** schema.sql, phase1d, 1e, 1f, 2a, 2b, 2c, 3t5, 3t2, 3t7. All present, none unlisted, missing file = exit 1 before any query (tested earlier with a fake URL).

**Destructive operations:** no DROP TABLE, TRUNCATE, DELETE, DROP COLUMN or CASCADE drops. What exists:
- `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT` on `orders.status` (1d), `second_hand_conditions.condition_grade` (1e), `users.role` (1f). Replaced with the same or wider rule; re-validates existing rows.
- `UPDATE` clean-ups (1d order statuses, 1e condition grades) that only match legacy lowercase values; current data is uppercase, so they match nothing on a normal database.
- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (same trigger recreated); `CREATE OR REPLACE FUNCTION set_updated_at`.
- 3t7 constraints are `NOT VALID` (existing rows not scanned).
- Latent: 2a adds `UNIQUE(owner_user_id)` on stores; it would fail (and roll back) if a populated database had two stores per owner. Irrelevant to an empty database.

**Transactions:** `pool.query(sql)` sends each file as one multi-statement simple query, which PostgreSQL runs as a single implicit transaction when the text has no explicit transaction commands (none do; the only `BEGIN` are inside `DO $$` blocks). So each file is all-or-nothing; across files it is not, and a failure after file N leaves 1..N applied. Re-running resumes. This is from PostgreSQL protocol behaviour, not observed here.

**Empty database:** statically consistent: every table/function/column referenced is created by an earlier file; inline CHECK constraints in schema.sql carry the names (`orders_status_check`, `users_role_check`, `second_hand_conditions_condition_grade_check`) that 1d/1e/1f drop. Extension: `pgcrypto` (only used for `gen_random_uuid`, which is built in on PostgreSQL 13+); needs permission to create it (Neon allows; **unverified live**). No other extensions, roles, grants or PostGIS.

**Second run:** safe on empty and populated data apart from brief table locks and the 2a caveat above; it will not lose data.

**Catalog seed:** all 8 SQL files have zero `users` references. Inserts use `ON CONFLICT DO NOTHING` (categories by name, books by ISBN, inventory and second-hand conditions by book_id); no NULL ISBNs found, so no duplicates on re-run. Overwrites: `fix_prices.sql` (12) and `fix_covers.sql` (13) UPDATE by **title only** on every run, so a re-run resets those books' prices/covers and would also hit any later book you create with the same title. **Run once.** `add_more_books_5.sql` is in no seed list.

## 2. Admin
- Registration: validation rejects any role except `customer`/`store_owner`; the controller then maps to `customer` or `store_owner`. No path creates `admin`.
- Schema: `users.email` is `UNIQUE`, registered lowercase; `role` allows `admin` (1f). Promotion matches at most one row. DEPLOYMENT.md now has SELECT first, `UPDATE ... RETURNING`, a zero-row recovery (usually an uppercase/misspelt email) and a revert-by-id statement.
- Session behaviour corrected: the server reads the role from the database on every request, but the React app keeps the role from the last `/auth/me` or login, so **reload the page** (or log out/in) after promotion. Previously documented as "no re-login needed", which was incomplete.

## 3. PowerShell commands
Script names verified in root and server `package.json` (`db:migrate`, `db:seed:catalog`). From the project root: `cd server`, set the variable, run `npm run db:migrate`, then `npm run db:seed:catalog` once, then `Remove-Item Env:DATABASE_URL`. Not executed (no PowerShell available).
**Defect found:** an empty paste removes the variable in PowerShell, after which dotenv loads `server\.env` (normally local PostgreSQL), so migrations could hit the local database. Fixes: (a) code: `migrate.ts` and `seed.ts` now print `Target database: <host> / <db>` (no user, password or query string; verified with a fake URL); (b) docs: a fail-closed `throw` if the variable is empty or contains localhost. The Bash alternative got the same check.

## Files changed
`server/src/db/pool.ts` (+ `describeDatabaseTarget`), `server/src/db/migrate.ts`, `server/src/db/seed.ts` (one log line each), `DEPLOYMENT.md`, this file.

## Checks run
Server and test `tsc --noEmit`: passed. Target-host print with a fake URL (password not printed), missing-file stop, no-env stop, seed production guard: behaved as intended, no connection made. Not run: migrations/seeds, tests (need a throwaway DB), Docker, PowerShell, anything live.

## Verdict
**SAFE TO BEGIN MANUAL NEON INITIALIZATION**, provided you use the updated DEPLOYMENT.md block, confirm the `Target database:` line shows your Neon host, and run `db:seed:catalog` once. Remaining unverified: pgcrypto permission on Neon and the migrations actually executing end to end (first real run is on Neon; if a file fails it rolls back that file and you can re-run).
