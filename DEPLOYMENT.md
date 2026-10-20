# BookNest deployment runbook (Windows / PowerShell)

Vercel (frontend) + Render (backend) + Neon (PostgreSQL) + Upstash (Redis). Nothing in this file has been run against live services. Script names were checked against `package.json`. The PowerShell snippets were written from standard PowerShell behaviour and could not be executed in the environment that prepared this file, so read the output of each command.

Legend: **[LOCAL]** = runs on your PC, touches no live service. **[MANUAL]** = you do it in a website or against a live service.

## How it fits together
Browser -> Vercel (static site) -> `/api/*` rewritten by `vercel.json` -> Render (Express) -> Neon + Upstash.
The client calls the relative path `/api`, so the browser only talks to the Vercel domain and the login cookie stays first-party. Never point client code at the Render URL.

## 0. Prepare your PC [LOCAL]
Open the VS Code terminal (PowerShell) at the project root (the folder containing `package.json` and `vercel.json`).
```powershell
node -v          # use Node 22 LTS (same major as Render)
npm ci           # installs exactly from package-lock.json
npm run build:server
npm run build:client
```
If PowerShell says "running scripts is disabled", run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` once in that terminal (affects only that window), or use `npm.cmd` instead of `npm`.
Optional local test run (needs a throwaway PostgreSQL whose name contains `test`; **never** your Neon database): `npm run test --workspace=server`. The test script uses a `tests/*.test.ts` pattern; on Node older than 21, Windows shells do not expand it, so use Node 22 for this.

## 1. Neon: migrate and seed the catalog [MANUAL, writes to Neon]
Prerequisite: section 0 done (`npm ci` installs `ts-node`, which `db:migrate` uses). In the Neon dashboard, copy the connection string (just the `postgresql://...` URL, not a `psql ...` command). Prefer the **direct** (non-pooler) one if both are shown. It must contain `?sslmode=require`.

Open the VS Code terminal (PowerShell) in the project root, the folder containing `package.json`, then run these blocks **one at a time**:

**A. Set and check the variable** (nothing here touches the database):
```powershell
cd server
$env:DATABASE_URL = Read-Host "Paste Neon connection string"
$u = $null
$ok = [Uri]::TryCreate($env:DATABASE_URL, [UriKind]::Absolute, [ref]$u) -and ($u.Scheme -in 'postgres','postgresql') -and ($u.Host -like '*.neon.tech') -and ($env:DATABASE_URL -match 'sslmode=require')
if ($ok) { "OK to continue. Host: $($u.Host)  Database: $($u.AbsolutePath.TrimStart('/'))" } else { Write-Host "STOP: DATABASE_URL is empty, malformed, not a *.neon.tech host, or lacks sslmode=require. Run Remove-Item Env:DATABASE_URL and start again." -ForegroundColor Red }
```
It prints only the host and database name, never the user or password. Compare them with the Neon dashboard (Connection details). If it printed STOP, do not continue.

**B. Migrate** (every command is guarded by `$ok`, so a failed check cannot reach the database, even if you paste several lines at once):
```powershell
if ($ok) { npm run db:migrate }
```
The first output line is `Target database: <host> / <database>`. It must match the host and database from block A (and the Neon dashboard). Compare the part before `.neon.tech` (it looks like `ep-...`; `-pooler` in it means a pooled connection). If it shows `localhost` or anything unexpected, press **Ctrl+C immediately**. Then expect ten `Applying ...` / `applied successfully` pairs and no `Migration failed`.

**C. Seed the catalog, once** (only after B finished with no error):
```powershell
if ($ok) { npm run db:seed:catalog }
```
Expect `Seeding catalog only (no demo accounts)...` and a line per SQL file.

**D. Clear everything:**
```powershell
Remove-Item Env:DATABASE_URL
Remove-Variable u, ok
cd ..
```
`$env:DATABASE_URL` should now print nothing. Closing the terminal also clears it.

These PowerShell blocks were written from standard PowerShell syntax and **have not been executed** (no PowerShell was available when this was prepared). The npm script names were checked against `package.json`: from `server/`, `db:migrate` runs `ts-node src/db/migrate.ts` and `db:seed:catalog` runs `ts-node src/db/seed.ts --catalog-only`.

**Why the checks exist:** in PowerShell, assigning an empty value to `$env:DATABASE_URL` (for example pressing Enter at the prompt) removes the variable. The scripts then fall back to `DATABASE_URL` in `server\.env`, normally your local PostgreSQL. A shell variable that is set always overrides `.env` (tested with dotenv), and your Neon string is never written to a file.

### Rules
- **`db:seed:catalog` runs exactly once.** `fix_prices.sql` and `fix_covers.sql` re-apply prices and covers by title on every run and would overwrite admin edits made later.
- **Never run `npm run db:seed` (no `:catalog`).** It creates demo accounts with public passwords. It refuses when `NODE_ENV=production` or the host is not local; never set `ALLOW_DEMO_SEED_REMOTE`.
- No demo stores are created, so "Nearby bookstores" is empty; books are still purchasable. `add_more_books_5.sql` is in no seed command.

### What the scripts do
`db:migrate` applies 10 files in this order: `schema.sql`, `migrations_phase1d`, `1e`, `1f`, `2a`, `2b`, `2c`, `3t5`, `3t2`, `3t7`. It exits with an error before touching the database if a file is missing or an unlisted `migrations_*.sql` exists. Each file runs as one implicit transaction (no explicit COMMIT anywhere): a failing file rolls back completely, earlier files stay applied. Nothing drops tables or deletes rows, and re-running is non-destructive. It needs the `pgcrypto` extension (`CREATE EXTENSION IF NOT EXISTS`); Neon should allow it, but that is **not verified live**. `db:seed:catalog` inserts categories, books and central inventory only, and creates no user accounts.

### If a migration fails partway (file N fails after files 1..N-1 succeeded)
Do **not** drop the database, delete the Neon branch/project, or reset anything. Nothing needs undoing: file N rolled back by itself and files 1..N-1 are valid.
1. Note the last `Applying <file>...` line and the error text. Do not paste your connection string anywhere.
2. Fix the cause. Typical ones: network or Neon cold-start timeout (just retry), a wrong or expired connection string (re-enter it), a permission error on `CREATE EXTENSION pgcrypto` (enable the extension in Neon, then retry), or a mistake in a SQL file (fix it locally; keep it re-runnable: `IF NOT EXISTS` style).
3. Verify the target again. If the terminal was closed, repeat block A; confirm the host and database.
4. Rerun `if ($ok) { npm run db:migrate }`. It starts from `schema.sql` again; the already-applied files are re-runnable and change nothing important. Repeat until all ten files report success.
5. Only after migrations succeed, run the seed (block C).
If the **seed** fails partway: each SQL file is its own transaction, so earlier files stay. Before you have edited any prices or covers in the app, re-running `db:seed:catalog` is safe. Once you have made edits, do not re-run it; ask for help with the specific error instead.

Bash alternative (Git Bash / WSL / macOS / Linux), same rules:
```bash
cd server
read -rs -p "Neon connection string: " DATABASE_URL && export DATABASE_URL
case "$DATABASE_URL" in postgres://*.neon.tech/*sslmode=require*|postgresql://*.neon.tech/*sslmode=require*) ;; *) echo "STOP: not a Neon URL with sslmode=require"; unset DATABASE_URL; exit 1;; esac
npm run db:migrate   # check the "Target database:" line, then, once:
npm run db:seed:catalog
unset DATABASE_URL
```

## 2. Vercel, first deploy [MANUAL]
Import the repo at its root (no Root Directory). Settings come from `vercel.json`. Leave the placeholder as is for now: it is a reserved `.invalid` hostname that can never resolve, so the site loads but every API call (including login) fails safely until step 5. Do not register or log in on this deployment before step 5 is done. Note the **production domain** (for example `https://<project>.vercel.app`; use the stable domain, not a per-deployment URL).

## 3. Upstash Redis [MANUAL, optional]
Create a database near Singapore and copy the **`rediss://`** (TLS) URL. Without Redis the app uses in-memory rate limiting and no cache.

## 4. Render [MANUAL]
New > Blueprint (uses `render.yaml`), or a manual Web Service with:
- Build: `npm ci --include=dev && npm run build:server` (`--include=dev` is required: Render sets `NODE_ENV=production` during the build, which would otherwise skip TypeScript)
- Start: `npm run start --workspace=server`; Health check path: `/api/health`; Node 22 (`NODE_VERSION=22.22.0`); region Singapore.

Environment variables:

| Variable | Value | Private? |
|---|---|---|
| `DATABASE_URL` | Neon string (`?sslmode=require`) | **Yes, set only in Render** |
| `REDIS_URL` | Upstash `rediss://` URL (optional) | **Yes, set only in Render** |
| `JWT_SECRET` | auto-generated by the blueprint, otherwise 32+ random characters | **Yes, set only in Render** |
| `CLIENT_ORIGIN` | Vercel production domain from step 2, no trailing slash (comma-separate extra origins) | No, but required |
| `NODE_ENV` | `production` | No |
| `NODE_VERSION` | `22.22.0` (already in `render.yaml`; set it yourself on a manual service) | No |
| `TRUST_PROXY` | `1` | No |
| `JWT_EXPIRES_IN` | `7d` | No |

The server exits at startup in production if `DATABASE_URL`, `CLIENT_ORIGIN` (or one pointing at localhost), `TRUST_PROXY` or a valid `JWT_SECRET` is missing. Do not set `PORT` (Render provides it and the server reads it). Note the service hostname Render shows. Free services sleep: the first request can take 30-60 s, so open `/api/health` before a demo.

## 5. Link Vercel to Render [MANUAL]
Edit `vercel.json` in VS Code. The `/api/:path*` rewrite currently points at the placeholder `https://replace-with-your-render-host.invalid/api/:path*`. You **MUST** replace `replace-with-your-render-host.invalid` with the actual hostname of your Render service (shown in the Render dashboard, e.g. `your-service.onrender.com`) before this Vercel deployment is used for login or any API request. The destination must start with `https://` (never `http://`) and keep the `/api/:path*` part, e.g. `https://your-service.onrender.com/api/:path*`. Leave the second rewrite (the single-page-app fallback) unchanged. Save, then redeploy Vercel by your normal method. If the `.invalid` host is still there, API calls fail; they must never be pointed at a hostname you do not control.

## 6. Create your admin [MANUAL, one database write]
Register in the live app first. Emails are stored in **lowercase**, so use your email in lowercase. In the Neon SQL editor, run the check **first**, on its own:
```sql
SELECT id, name, email, role, created_at FROM users WHERE email = 'you@example.com';
```
**Verify before updating:** exactly one row, the `name` and `email` are yours, `role` is `customer`, and `created_at` is the time you just registered. If it is 0 rows, check spelling and case (or run `SELECT email FROM users;`). Do not continue until it is exactly your account. Then run:
```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com' RETURNING id, email, role;
```
`users.email` is `UNIQUE`, so at most one row can change; the result should show one row with `role = admin`.
- **Zero rows updated:** nothing changed; fix the email and repeat the check.
- **Wrong account promoted:** `UPDATE users SET role = 'customer' WHERE id = '<id from RETURNING>';`
After promotion, **reload the page** (the server checks the role in the database on every request, and the site re-reads it from `/api/auth/me` on page load); logging out and in also works. Public registration only accepts `customer` or `store_owner`, never `admin`.

## 7. Smoke test [MANUAL, needs live services]
1. `https://<vercel-domain>/api/health` returns `{"status":"ok",...}` (proves the rewrite and Render).
2. Register a customer; refresh the page: still logged in (cookie works).
3. Log out, log in. Browse the catalog, search, open a book.
4. Add to cart and check out. Checkout is labelled MOCK PAYMENT; no real payment happens.
5. Log in as your admin and open the admin pages.
6. TRUST_PROXY test below.

## TRUST_PROXY (unverified, fail-safe default 1)
The proxy hop count between a browser and Express on Vercel -> Render cannot be verified without a live deployment. `1` errs on the strict side (users may share one rate-limit bucket) and cannot be spoofed; too high a value lets clients choose their own address. Never use `true`.
1. From network A (home Wi-Fi) submit a wrong password for throwaway account X five times (blocked after the 5th).
2. From network B (phone on mobile data) try a wrong password for throwaway account Y. Normal behaviour = correct. Blocked immediately = shared bucket: set `TRUST_PROXY=2` in Render, redeploy, repeat.
The block clears after 15 minutes.

## Known limits
- Payments are MOCK ONLY.
- Remaining `npm audit` items: see `PHASE3_TASK11_SUMMARY.md`.
- Never commit `.env`; rotate any secret ever pasted into chat or a file.
