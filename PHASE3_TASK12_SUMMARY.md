# Phase 3, Task 12: Windows runbook and final safety check

Baseline: Task 11 contents. Original ZIPs untouched. Only `DEPLOYMENT.md` and this file changed; no source, SQL, config or dependency edits. No database contact, no migrations/seeds/admin scripts, no Git, nothing deployed.

## Problems found in the Task 11 instructions
1. `DATABASE_URL='...' npm run db:migrate` is Bash-only syntax and fails in PowerShell. Replaced with `$env:DATABASE_URL = Read-Host ...` (keeps the string out of command history and files), `Remove-Item Env:DATABASE_URL` to clear it, and a Bash alternative.
2. Task 11 told you to keep the placeholder hostname without `https://`, but `vercel.json` already contains `https://`. Step 5 now says to replace only the hostname.
3. The server test script uses the glob `tests/*.test.ts`, which Windows shells do not expand on Node older than 21. Documented (use Node 22 for local tests). Script not changed.
4. Added the common PowerShell "running scripts is disabled" workaround for `npm`.

## Checked against the actual code (read-only)
- Script names exist: root `db:migrate`, `db:seed:catalog`, `db:migrate:prod`, `build:server`, `build:client`, `start:server`; server `db:migrate`, `db:seed:catalog`, `start`, `test`.
- 10 migrations listed, all present, no unlisted `migrations_*.sql`, order as documented; a missing file stops with exit 1 (tested in Task 10 and 11).
- Shell variable overrides `.env`: tested with dotenv (shell value won).
- Catalog SQL files contain no `users` statements; `--catalog-only` skips the account and store seeding; `db:seed` is blocked in production and for non-local hosts (override variable `ALLOW_DEMO_SEED_REMOTE` exists; the docs say never set it).
- Catalog seed once: inserts skip duplicates, but `fix_prices.sql`/`fix_covers.sql` UPDATE by title each run.
- Admin SQL: `users_role_check` allows `admin`; auth reads the role from the database per request.

## Not verified
The PowerShell snippets (no PowerShell here; standard syntax, not executed), all live behaviour (Neon, Upstash, Render, Vercel rewrite, cookies, CORS, TRUST_PROXY value), the server tests (need a throwaway test DB), Docker.

## Shortest list of manual steps
1. `npm ci`, then the two builds (local).
2. Neon: PowerShell block in DEPLOYMENT.md section 1 (migrate, seed once, clear the variable).
3. Vercel first deploy, note the production domain.
4. Upstash (optional), copy the `rediss://` URL.
5. Render: set `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` privately, plus `CLIENT_ORIGIN`, `NODE_ENV`, `TRUST_PROXY=1`, `JWT_EXPIRES_IN`.
6. Put the Render hostname in `vercel.json`; redeploy Vercel.
7. Register, promote yourself to admin (one SQL line), run the smoke test and the two-network test.
