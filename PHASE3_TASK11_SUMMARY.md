# Phase 3, Task 11: Final pre-deployment audit

Baseline: Task 10 contents. Original ZIPs untouched (`booknest_task10.zip` still exists unchanged). No database contact, no migrations/seeds/admin scripts run, no Git, nothing deployed.

## Issues found
1. **Render build would have failed (real, reproduced).** `render.yaml` set `NODE_ENV=production`, which Render also applies at build time; `npm ci` then skips dev dependencies and `tsc` is missing. Reproduced in a scratch copy (plain `npm ci` + build failed; `npm ci --include=dev` + build passed). FIXED in `render.yaml` and docs.
2. **Circular deployment order.** The server refuses to start without `CLIENT_ORIGIN`, which needs the Vercel URL, while Vercel needs the Render hostname. `DEPLOYMENT.md` rewritten with a working order (Neon -> Vercel first deploy -> Upstash -> Render -> edit `vercel.json` and redeploy -> admin -> smoke test) and says to use the stable Vercel production domain.
3. **Catalog seed repeat-safety was overstated.** Inserts are `ON CONFLICT DO NOTHING`, but `fix_prices.sql`/`fix_covers.sql` UPDATE by title on every run and would overwrite admin price edits. Docs now say run it once. Also documented: no demo stores exist (Nearby page empty), and `add_more_books_5.sql` is in no seed command.

## Verified against the code
- Commands exist: `npm run db:migrate` and `npm run db:seed:catalog` work from `server/` or repo root; `db:migrate:prod` needs a build first. A shell `DATABASE_URL` takes precedence over any `.env` (dotenv does not override).
- Migration order (10 files) and compiled-output resolution: checked in Task 10 (19 SQL files copied to `dist/db`); not repeated.
- Seed protection: `db:seed` refuses on `NODE_ENV=production` or a non-local host; `--catalog-only` runs no user inserts (the catalog SQL files contain no `users` statements).
- Admin instruction: `users_role_check` allows `'admin'`; auth reads the role from the database on every request, so no re-login is needed. Registration cannot request `admin`.
- `vercel.json` has the marked placeholder; `/api/*` is excluded from the SPA fallback; the client uses relative `/api` with `credentials: include`.
- `TRUST_PROXY`: numeric/"true"/"false"/string parsing in `index.ts`; value 1 kept; docs warn never to use `true`; two-network test documented. Still unverified live.
- Secrets: example files contain placeholders only. The only credentials-looking strings are the local docker-compose defaults (`booknest_pass`), not production secrets.

## Not verified (needs live services or tools I lack)
Vercel rewrite behaviour (paths, queries, Set-Cookie passthrough), real cookie/CORS behaviour end to end, Neon/Upstash TLS connections, `TRUST_PROXY` value, server tests (need a throwaway test DB), Docker build (no Docker), whether Neon's pooler string works for migrations (docs recommend the direct string).

## Audit status (from Task 10, unchanged)
Production runtime: 2 moderate (react-router 6.30.6; no SSR, redirects use internal router state; upgrade to v7 after the review, not now). Dev/build tooling only: Vite/esbuild, ts-node-dev/braces/chokidar.

## Files changed
`render.yaml`, `DEPLOYMENT.md`, this file.

## Manual actions
1. Neon: run `db:migrate`, then `db:seed:catalog` once (commands in DEPLOYMENT.md).
2. Vercel: first deploy, note the production domain.
3. Render: deploy with the env vars; note the hostname.
4. Edit `vercel.json` hostname; redeploy Vercel.
5. Register, promote yourself to admin with the one SQL line, run the smoke test and the TRUST_PROXY test.
6. Locally, run the test suite against a `*_test` database.
