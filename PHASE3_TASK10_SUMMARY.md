# Phase 3, Task 10: Final deployment verification

Starting point: Task 9 ZIP contents. The original uploaded ZIPs were not modified. Nothing was deployed; no database, local or Neon, was contacted; no migration, seed or admin script was run; no Git operations.

## Audit findings (ranked)
1. **Critical/high prod vulnerabilities** (`tar` via `bcrypt` 5.1.1 -> `@mapbox/node-pre-gyp`). FIXED (see below).
2. **TRUST_PROXY=2 was an unverified guess** and the less safe direction (too high lets clients choose their address). CHANGED to the fail-safe `1`; validation procedure in DEPLOYMENT.md section 5. Still UNVERIFIED until a live deploy.
3. **No graceful shutdown** (Render sends SIGTERM on each deploy). FIXED.
4. **Test suite cannot run without a throwaway PostgreSQL** (all tests import a helper that requires `TEST_DATABASE_URL`). Not run; needs you.
5. **Docker image path untested** (no Docker here); Dockerfile uses `npm install` without the root lockfile. Not needed for the Render Node deploy; left as is.

Verified safe (no change): public registration cannot create admin accounts (role limited to customer/store_owner); cookie is httpOnly, secure in production, sameSite=lax; migration list matches the 10 migration files with none unlisted; compiled `dist/db` contains all 19 SQL files.

## Changes
- `server/package.json` + `package-lock.json`: `bcrypt` ^5.1.1 -> ^6.0.0 (removes the whole `tar`/`node-pre-gyp` chain); `npm audit fix` (non-breaking) updated a transitive dev package. No `--force`.
- `server/src/index.ts`: graceful shutdown (SIGTERM/SIGINT: stop listening, close PostgreSQL and Redis, 10 s force-exit).
- `render.yaml`, `server/.env.production.example`: `TRUST_PROXY` 2 -> 1.
- `DEPLOYMENT.md`: TRUST_PROXY test procedure, compiled migrate command, admin-bootstrap ordering, shutdown note.
- This file.

## Real check results
| Check | Result |
|---|---|
| `npm ci` / install | passed |
| Server `tsc --noEmit`, tests `tsc --noEmit` | passed |
| Server build (copies 19 SQL files to `dist/db`) | passed |
| Client `tsc -b && vite build` | passed |
| bcrypt 6 hash/compare smoke test (own script, no DB) | passed (correct password true, wrong false) |
| Compiled `migrate.js` with a required SQL file removed | exit code 1, before any DB connection |
| Production startup: missing CLIENT_ORIGIN/TRUST_PROXY; short JWT secret | both exit 1 with clear message |
| `vercel.json` valid JSON; SPA fallback pattern vs `/api/*` | `/api/...` excluded from fallback; other paths fall back |
| `npm audit --omit=dev` | 2 moderate (was 1 critical, 2 high, 2 moderate) |
| `npm audit` (all) | 7: 3 moderate, 4 high (was 11 incl. 1 critical) |
| Server test suite | NOT RUN (needs throwaway test DB; none available here) |
| Docker build | NOT RUN (Docker not installed) |
| Live deploy, Vercel rewrite behaviour, cookies end to end | NOT VERIFIED |

## Remaining audit items
- **react-router / react-router-dom 6.30.6 (moderate, shipped to browsers):** open-redirect and SSR-hydration advisories. Fix is v7 (breaking). Assessment: the app has no SSR, and its only dynamic redirect uses internal router state, not URL input. Risk judged low; upgrade after the review.
- **Dev/build tooling only (not in the Render runtime):** vite/esbuild dev-server advisories (fix needs Vite 8), braces/chokidar via ts-node-dev. Affect developer machines, not the deployed server. Do not expose a Vite dev server publicly.

## Unverified assumptions
- Vercel rewrites keep query strings and serve built static files before the SPA fallback (standard Vercel behaviour, not tested here).
- `CLIENT_ORIGIN` must exactly equal the Vercel origin the browser uses (no trailing slash); the server strips trailing slashes.
- Existing user password hashes keep working with bcrypt 6 (same hash format); not tested against real data.

## Exact deployment steps
1. Neon: run `npm run db:migrate` then `npm run db:seed:catalog` from your machine with `DATABASE_URL` in your shell only. Register your account in the live app, then promote it to admin with the SQL in DEPLOYMENT.md.
2. Upstash: create DB, copy the `rediss://` URL.
3. Render: deploy via `render.yaml`; set `DATABASE_URL`, `REDIS_URL`, `CLIENT_ORIGIN` (after step 4). Confirm `/api/health`.
4. Vercel: put the real Render hostname in `vercel.json`, deploy from the repo root, then set Render `CLIENT_ORIGIN` to the Vercel URL and redeploy.
5. Smoke test and run the TRUST_PROXY two-network test (DEPLOYMENT.md section 5).
6. Locally, run `npm run test --workspace=server` against a throwaway `*_test` database.
