# Phase 3, Task 8 — Security pass (OFFLINE, PARTIAL)

## 1. Executive summary
This task was done in a session where the npm registry was blocked (HTTP 403 from the session's network policy), the npm cache was empty, and the Docker daemon was not running. **No dependency could be installed, so the project's own test suite, type checks, builds, `npm audit`, browser checks and Docker build/run were NOT run.**

What was done: a per-client rate limiter was added to the two public discovery endpoints (no new dependencies), the misplaced `.dockerignore` was fixed (it let `server/.env` be copied into the Docker image), PostgreSQL/Redis ports in Compose were bound to loopback, and a focused test file was written. The limiter's logic was exercised outside the project's test suite (section 6). **Nothing here is verified against the real project; treat it as unverified until you run section 11.** Not claimed production-ready.

## 2. Files
Added: `server/src/middleware/rateLimit.ts`, `server/src/utils/clientIp.ts`, `server/tests/rateLimit.test.ts`, `server/.dockerignore`, this file.
Modified: `server/src/routes/storeRoutes.ts` (limiter on the two public routes), `server/tests/helpers.ts` (one env line, see 5), `docker-compose.yml` (ports), `server/.env.example` (documented new variables).
Removed: `server/src/.dockerignore` (misplaced and inert; its four rules were carried into `server/.dockerignore`).
`package.json` files and `package-lock.json` are byte-identical to the supplied ZIP. `.git/` is included exactly as supplied; no Git operation was performed.

## 3. Source-code changes completed
1. **Rate limiter** (`middleware/rateLimit.ts`), applied to `POST /api/stores/nearby` and `GET /api/stores/:storeId/books`.
   - Fixed window, one **shared** bucket per client across both routes.
   - Redis when connected (atomic Lua: INCR, set TTL on first hit, repair a key with no TTL); bounded in-memory map when Redis is absent or a Redis call fails. Same fallback style as `loginRateLimiter.ts`. With several server instances and Redis down, each instance counts separately (limit effectively multiplied).
   - Client = `req.ip`. `X-Forwarded-For` / `X-Real-IP` / `Forwarded` are ignored unless the operator sets `TRUST_PROXY` (existing mechanism in `index.ts`). IPv4-mapped IPv6 is unwrapped; IPv6 is counted per /64 so rotating addresses does not bypass it.
   - Stores only `rl:discovery:<client key>` and a counter for one window. It never reads the body or query string, so coordinates are not logged, stored or echoed.
   - 429 response: `{"error":"Too many requests. Please wait a moment and try again.","retryAfterSeconds":N}` plus `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Cache-Control: no-store`. Allowed responses also carry the `RateLimit-*` headers.
   - Runs before validation, so malformed requests count too. Login, cart, checkout, orders, owner routes and the rest of the catalogue are untouched.
   - If the limiter itself throws unexpectedly it fails open (the public endpoints stay up).
2. **Config** (read on every request): `DISCOVERY_RATE_LIMIT_MAX` (default **60**, allowed 1–100000) and `DISCOVERY_RATE_LIMIT_WINDOW_SECONDS` (default **60**, allowed 1–3600). Missing/invalid values fall back to defaults. There is deliberately no "0 = off".
3. **Docker ignore fix** — see 4.1.
4. **Compose**: Postgres and Redis now publish on `127.0.0.1` only (`"127.0.0.1:5432:5432"`, `"127.0.0.1:6379:6379"`). Redis has no password; previously it was reachable on every host interface. Containers still reach each other by service name; host-run dev (`localhost`) is unaffected. Anyone connecting from another machine must now change this.

## 4. Static inspection findings
### 4.1 `.dockerignore` (fixed)
- The Compose build context is `./server`, and Docker reads `.dockerignore` only from the context root. The file was at `server/src/.dockerignore`, so it was **never applied**. There is no root `.dockerignore` (and none would apply, since the context is `./server`).
- Effect: `COPY . .` copied `server/.env` (if present), host `node_modules` and `dist` into the image. Looks accidental (the rules are the standard ones).
- Fix: `server/.dockerignore` with the old rules plus `.env.*` (keeping `.env.example`), `*.log`, `*.tsbuildinfo`, `tests`. The image build only compiles `src/` (`tsconfig.json` includes `src/**/*.ts`), so excluding `tests` should not affect it — **but no image was built to confirm**.
### 4.2 Dockerfile (NOT changed — needs a real build to verify)
- `FROM node:18-alpine`: Node 18 is end-of-life. Lockfile engines check: every package accepts Node 18 except `@napi-rs/lzma-linux-x64-gnu` (dev, optional dependency of rollup, glibc-only, needs Node ≥22.20); on Alpine (musl) it is skipped, on a glibc Node 18 it would only warn. The previous task's tests ran on Node 22. Recommendation: move to `node:22-alpine` (or 20) **after** a local `docker compose build` confirms `bcrypt` installs and the server boots. Not changed because it cannot be verified here.
- `RUN npm install` in a context that contains only `server/`: the lockfile lives at the repo root, so the image resolves dependencies fresh at build time (non-reproducible, ignores the audited lockfile). `npm ci` is only possible if the build context becomes the repo root and the Dockerfile installs the workspace (e.g. copy root `package*.json` + `server/package.json`, `npm ci -w server`). That is a larger change to Dockerfile and Compose that cannot be tested here, so it was left as is. The final image also keeps dev dependencies and runs as root.
- Compose: hard-coded demo DB credentials (acceptable for local dev only); no healthcheck on the `server` service (`/api/health` exists); `version: "3.9"` is obsolete (warning only).
### 4.3 Discovery endpoints (code read, no change needed unless noted)
- Validation: body must be a JSON object; coordinates both-or-neither and range-checked; radius 1–500; `limit` ≤ 50; text ≤ 100 chars; array/object values for `search`/`page`/`limit` produce 422; store id must be a UUID (400).
- SQL: all user values are bound parameters; LIKE wildcards escaped; the only interpolated pieces are fixed fragments and `$n` placeholders. No injection path found.
- Privacy: public store fields are an explicit allow-list (no owner id, email, phone, raw coordinates). Nearby responses are `no-store`. `morgan("dev")` logs URLs, so the `?search=` text of the books endpoint is logged (not coordinates, which are in a POST body). Inactive stores return 404.
- Authorization: owner-only store routes are unchanged (`requireAuth` + `requireRole`).
- Noted, not changed: in distance mode the available-book-count subquery is evaluated for every store inside the latitude band before `LIMIT`; with a 500 km radius and many stores this is the most expensive request. The new limiter reduces abuse but does not fix the query shape. Worth profiling with real data.

## 5. Tests added but NOT executed against the project
`server/tests/rateLimit.test.ts` (16 tests; 2 are skipped when no Redis is configured): IP key normalisation, config parsing, 429 body/headers, no echo of coordinates or search text, shared bucket across both routes, validation errors counting, spoofed `X-Forwarded-For` ignored, reset and real 1-second window expiry, login/catalogue/cart/owner routes unaffected while limited, separate buckets behind `trust proxy`, Redis counter has TTL and contains no request data, Redis counter repairs a missing TTL.
`server/tests/helpers.ts`: one added line sets `DISCOVERY_RATE_LIMIT_MAX=100000` so the existing suites (which send many requests from one address) are not throttled; `rateLimit.test.ts` lowers it per test. No existing test was changed, removed or weakened.
Assumptions in the unexecuted tests that your first run will confirm: `GET /books` is public (200), `GET /cart` (customer) and `GET /stores/orders` (owner A) return 200.

## 6. Checks actually executed, with results
| Check | Result |
|---|---|
| Lockfile and all `package.json` files vs supplied ZIP | byte-identical |
| Offline harness (`tsx`, `redis`/`dotenv` replaced by stubs, so the **in-memory path only**) running `clientIp.ts` and `rateLimit.ts` with fake request/response objects: IP normalisation, config parsing and fallbacks, limit then 429, headers, per-client buckets, reset, 1 s real window expiry | **14 of 14 passed**. This is NOT the project's test suite. |
| The limiter's Lua script against a real `redis-server` 7.0.15 via `redis-cli`: count increments, TTL set on first hit, key with no TTL repaired, counter restarts after expiry | passed |
| `docker compose config -q` (with a dummy `JWT_SECRET`) | valid; only warning: `version` is obsolete |
| Syntax-only TypeScript parse of the new/edited files (`--isolatedModules`, missing-module and library errors filtered out) | no syntax errors. **This is not a type check.** |

## 7. Checks blocked by the environment (not run, no result)
`npm ci` / `npm install` (registry 403, empty cache); `npm audit`; full server tests with and without Redis; server, test and client `tsc`; server and client production builds; database migration/seed runs (the Node `pg` driver was not installable; migrations were not touched by this task); Playwright/browser checks of the Nearby Bookstores and Store Books pages; Docker build, container start, health checks and endpoint checks (Docker daemon not running). The browser items from Task D (permission states, responsive layout, loading/empty/error states) therefore remain exactly as untested as in Task 7.

## 8. Dependency vulnerabilities: unknown until a fresh audit runs
No audit result exists for the current lockfile. The earlier "11 vulnerabilities (1 critical, 7 high, 3 moderate)" figure could be neither confirmed nor refuted and may be outdated. Lockfile facts (v3, 365 entries) for orientation only, **not a safety claim**: express 4.22.3, body-parser 1.20.8, jsonwebtoken 9.0.3, pg 8.23.0, redis 4.7.1 (`@redis/client` 1.6.1), helmet 7.2.0, bcrypt 5.1.1, vite 5.4.21, esbuild 0.21.5, react-router 6.30.6. Worth looking at first when the audit output arrives (from memory, unchecked): the production install chain `bcrypt` → `@mapbox/node-pre-gyp` 1.0.11 → `tar` 6.2.1 / `node-fetch` 2.7.0; older `glob` 7.2.3, `minimatch` 3.1.5, `debug` 2.6.9; dev-only `esbuild` 0.21.5 (dev-server advisories exist for older esbuild versions) and the `ts-node-dev` tree. Run the commands in 11 and do not use `--force`.

## 9. Known limitations
- The rate limiter and its tests have never run inside the project. A mistake there would show up as a failing `rateLimit.test.ts` or, worse, an existing suite; run the full suite before relying on it.
- `redisClient.eval(script, { keys, arguments })` follows the node-redis v4 API from memory; the Lua itself was verified, the Node call was not.
- The memory fallback is per process; limits are per client address, so users behind one shared NAT share an allowance (raise `DISCOVERY_RATE_LIMIT_MAX` if needed).
- Behind a reverse proxy, set `TRUST_PROXY` correctly, otherwise every visitor shares the proxy's address and one bucket.

## 10. Manual steps for you
Run section 11. Then decide on the Dockerfile items in 4.2 (Node version, `npm ci` with a root build context). Check the Nearby/Store Books pages in a browser (location allowed/denied/timeout, mobile and desktop widths, empty and error states).

## 11. Commands to run locally
```bash
# 1. clean install exactly from the lockfile (does not rewrite it)
npm ci

# 2. fresh audit - record the output; do NOT use --force
npm audit
npm audit --omit=dev

# 3. tests (throwaway DB whose name contains "test"; Redis optional)
export TEST_DATABASE_URL=postgres://<user>:<pw>@127.0.0.1:5432/booknest_test
export TEST_REDIS_URL=redis://127.0.0.1:6379
npm test --workspace=server                     # with Redis (expect 257 + 16 new tests)
unset TEST_REDIS_URL && npm test --workspace=server   # without Redis
# only the new file:
cd server && node --require ts-node/register/transpile-only --test tests/rateLimit.test.ts

# 4. types and builds
(cd server && npx tsc -p tsconfig.json --noEmit && npx tsc -p tests/tsconfig.json --noEmit)
(cd client && npx tsc -p tsconfig.json --noEmit)
npm run build:server && npm run build:client

# 5. Docker (JWT_SECRET required)
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
docker compose config -q && docker compose build server
docker compose up -d && curl -s localhost:4000/api/health
docker compose exec server ls -a /app | grep -c "^\.env$"   # expect 0: .env is no longer copied into the image
# quick limiter check (default 60/min): expect 200s then 429s
for i in $(seq 1 65); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:4000/api/stores/nearby -H 'content-type: application/json' -d '{}'; done; echo
```
