# Phase 3, Task 14: Final deployment handoff

Baseline: Task 13 contents. Documentation-only changes (`DEPLOYMENT.md`, this file). No source, SQL, config or dependency edits. No database contacted, no migrations/seeds/admin SQL run, no Git, nothing deployed. Original ZIPs untouched.

## Documentation defects found and fixed
1. **The Task 13 PowerShell `throw` did not actually stop the run.** In an interactive terminal, pasted lines execute one after another; a `throw` on line 3 does not prevent line 4 (`npm run db:migrate`) from running. Replaced with a `$ok` flag and `if ($ok) { ... }` on every database command, so a failed check cannot reach the database even if everything is pasted at once.
2. **The check covered only empty/localhost.** It now also requires: a parseable URL, scheme `postgres`/`postgresql`, host ending `.neon.tech`, and `sslmode=require`. It prints only host and database name (no user/password) for comparison with the Neon dashboard and the script's `Target database:` line.
3. **No procedure for a failed migration or seed.** Added: do not drop/reset anything; file N rolled back by itself; fix cause; re-verify target; rerun from the start safely; seed-failure caveat (safe to re-run only before you have edited prices/covers).
4. **Admin step did not force verification.** Now a separate `SELECT` (id, name, email, role, created_at) with explicit "verify it is your account, role `customer`, just created" before the `UPDATE ... RETURNING`.
5. **Render table:** added `NODE_VERSION` (needed on a manual service) and a note not to set `PORT`.
6. Bash alternative now uses the same strict Neon-URL pattern.

## Verified (static / local)
- Scripts: from `server/`, `db:migrate` = `ts-node src/db/migrate.ts`; `db:seed:catalog` = `ts-node src/db/seed.ts --catalog-only` (root has matching passthroughs). `npm ci` first is required for ts-node (section 0).
- Env vars read by the server: `NODE_ENV, DATABASE_URL, TRUST_PROXY, REDIS_URL, CLIENT_ORIGIN, PORT, JWT_SECRET, JWT_EXPIRES_IN` (+ `ALLOW_DEMO_SEED_REMOTE`, never to be set). Matches `render.yaml` and the docs table; secrets are `sync:false`/generated, none in files.
- `vercel.json` contains the placeholder `REPLACE-WITH-YOUR-RENDER-SERVICE.onrender.com`; `/api/*` is excluded from the SPA fallback; docs require the stable Vercel production origin in `CLIENT_ORIGIN`.
- `db:seed` is blocked for production and non-local hosts; `db:seed:catalog` must run once (title-based price/cover updates).
- Admin SQL matches the schema (`users`: id, name, email UNIQUE, role CHECK incl. `admin`, created_at).
- Bash URL gate tested with sample strings (accepts a Neon URL; rejects empty, localhost, `psql ...` prefix, look-alike `neon.tech.evil.com`, missing sslmode).

## NOT verified (needs PowerShell or live services)
- The PowerShell blocks themselves were never executed (no PowerShell here).
- Neon: connectivity, `pgcrypto` permission, the 10 migrations and the seed actually running end to end.
- Upstash, Render build/start, Vercel rewrite, cookies/CORS, `TRUST_PROXY` value, the smoke test, the admin promotion.
- Server tests (need a throwaway test DB) and Docker.

## Next manual steps
1. Section 0: `npm ci`, both builds. 2. Section 1 blocks A -> B -> C -> D, one at a time; confirm host/database each time. 3. Vercel first deploy, note the production domain. 4. Upstash (optional). 5. Render with the table's variables. 6. Put the Render hostname in `vercel.json`, redeploy Vercel. 7. Register, verify the SELECT, promote, reload. 8. Smoke test and the two-network TRUST_PROXY test.
