# Phase 3, Task 9: Deployment readiness

## Inspected
All server SQL/migration/seed files, `migrate.ts`, `pool.ts`, `index.ts`, auth cookie code, Redis config, Dockerfile, docker-compose, package scripts, tsconfigs, client API/Vite config, Task 8 summary. Original ZIP untouched.

## Blockers found (priority order) and status
1. **Cross-site cookie on Vercel + Render**: cookie is `sameSite=lax`, so login would silently fail if the client called Render directly. FIXED by `vercel.json` rewrite (same-origin `/api`). You must put your real Render hostname in it.
2. **Demo seed creates/overwrites known passwords** (`Admin@123` etc., with `DO UPDATE SET password_hash`). FIXED: `db:seed` refuses on `NODE_ENV=production` or non-local DB host; new `db:seed:catalog` loads books only.
3. **Migrations could be silently skipped** (`Skipping ... not found`) and SQL is not copied into `dist/`. FIXED: hard failure on missing/unlisted file, SQL dir resolution, build copies SQL to `dist/db`, `db:migrate:prod` added.
4. **No production startup validation** for `CLIENT_ORIGIN`, `DATABASE_URL`, `TRUST_PROXY`. FIXED in `index.ts` (JWT validation already existed). CORS now accepts comma-separated origins.
5. **Node 18 (EOL) in Dockerfile/engines; Redis 2 s timeout, no TLS guidance.** FIXED: Node 20, Redis timeout 5 s, `rediss://` documented.

## Migration order check
Verified from the SQL: schema -> 1d -> 1e -> 1f (stores) -> 2a -> 2b -> 2c -> 3t5 -> 3t2 -> 3t7. 3t5 and 3t2 are independent, so the existing order is valid; unchanged.

## Files changed/added
`server/src/db/migrate.ts`, `server/src/db/seed.ts`, `server/src/index.ts`, `server/src/config/redis.ts`, `server/package.json`, `package.json`, `server/Dockerfile`, `.gitignore`; new: `server/scripts/copy-sql.js`, `vercel.json`, `render.yaml`, `server/.env.production.example`, `client/.env.example`, `DEPLOYMENT.md`, this file.

## Checks
| Check | Result |
|---|---|
| `npm ci` | passed |
| Server `tsc --noEmit` | passed |
| Test `tsc --noEmit` | passed |
| Server build (`npm run build`, copies 19 SQL files) | passed |
| Client build (`tsc -b && vite build`) | passed |
| Seed guard (production, and remote host) | refused as intended (no DB contacted) |
| Migrate missing-file guard | failed hard as intended (no DB contacted) |
| Production config validation | exited with clear errors as intended |
| `npm audit --omit=dev` | 5 vulns (1 critical, 2 high, 2 moderate), all `tar` via `bcrypt` -> `@mapbox/node-pre-gyp` (install-time tooling). Fix needs bcrypt 6 (breaking); not applied. |
| Server test suite | NOT RUN (needs a throwaway `TEST_DATABASE_URL`; I would not run it against any database) |
| Migrations/seeds against a DB, Docker build, live deploy | NOT RUN |

## Not verified / your steps
- `TRUST_PROXY=2` is an estimate. `add_more_books_5.sql` exists but is not in any seed list (pre-existing; decide if needed).
- Mock payment text already exists on checkout, success and order pages; no changes made.
- Follow `DEPLOYMENT.md`. Run the test suite locally against a throwaway DB.
