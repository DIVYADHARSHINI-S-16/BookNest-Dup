# Phase 3, Task 15: Two minimal deployment safety fixes

Source of truth: `booknest_task14.zip` (left untouched). Only configuration and documentation were edited. No source code, SQL, dependency, lockfile, authentication or business-logic change. No database contacted, no migration/seed, no Git, nothing deployed.

## Exact changes
| File | Change |
|---|---|
| `render.yaml` | `NODE_VERSION` `"20"` -> `"22.22.0"` |
| `vercel.json` | rewrite destination `https://REPLACE-WITH-YOUR-RENDER-SERVICE.onrender.com/api/:path*` -> `https://replace-with-your-render-host.invalid/api/:path*`. Source `/api/:path*` and the SPA fallback `/((?!api/).*)` -> `/index.html` are unchanged. |
| `DEPLOYMENT.md` | Section 0: local Node advice now "Node 22 LTS (same major as Render)". Section 2: explains the `.invalid` placeholder never resolves, so API calls and login fail safely; do not register or log in before step 5. Section 4: "Node 22 (`NODE_VERSION=22.22.0`)" and the env table value `22.22.0`. Section 5: the placeholder **MUST** be replaced with the real Render hostname before the Vercel deployment is used for login or any API request; the destination must be `https://` plus that hostname plus `/api/:path*`. |
| `PHASE3_TASK15_SUMMARY.md` | this file (new) |

Why `22.22.0` and not `22`: Render's docs accept a full version or an alias and do not confirm a bare major, so a full version avoids that doubt. 22.22.0 is the Node version used for the earlier tested builds. Trade-off: it will not pick up newer 22.x patches until you change it.

## Other Node declarations checked (not changed)
- Root and `server/package.json` `engines.node` is `>=20.0.0`: already allows 22; changing it would edit `package.json`, so left.
- `server/Dockerfile` `FROM node:20-alpine`: used only by the local Docker Compose setup, not by the Render deployment (Render uses the native Node runtime). Not changed because no Docker build is possible here; consider `node:22-alpine` separately.
- No `.nvmrc`, `.node-version` or `.tool-versions` exists. The lockfile and dependencies are untouched.

## Checks performed
- Exact-string edits (each target text existed exactly once); `vercel.json` parses as valid JSON and still has the two rewrites in the same order.
- No remaining occurrence of the old placeholder in deployment files; no remaining "Node 20" in `render.yaml` or `DEPLOYMENT.md`.
- Diff of the output tree against the extracted Task 14 ZIP: only `render.yaml`, `vercel.json`, `DEPLOYMENT.md` changed and `PHASE3_TASK15_SUMMARY.md` added.
- SHA-256 of `booknest_task14.zip` taken before and after the work: identical.
- npm registry probe: still blocked, so no `npm ci`, build or test was run. **No build or test is claimed to have passed.**

## Not verified
- Whether Render accepts `NODE_VERSION=22.22.0` (check the first build log) and that the build/start succeed on Node 22 (earlier tasks built on Node 22 locally, not re-run here).
- Whether Vercel accepts a rewrite to an `.invalid` host without a validation complaint. It is syntactically a valid hostname and the file is valid JSON, but this was not tested. If Vercel rejects it at deploy time, report the exact message rather than working around it.
- Everything from the Task 14 list: Neon migration/seed, Upstash, Render and Vercel behaviour, cookies, `TRUST_PROXY`, PowerShell blocks, server tests, Docker.

## Next action
On your Windows PC, in the project root: `node -v` (should show v22.x; install Node 22 LTS if not), then `npm ci`, `npm run build:server`, `npm run build:client` (runbook section 0).
