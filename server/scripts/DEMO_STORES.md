# Demo bookstore generator

Creates 8 clearly labelled **demo bookstores** in your Neon database so you can show multi-store features (nearby search, store prices, store-owner login) at your project review.

Script: `server/scripts/seed-demo-stores.ts`

## What it creates

| Thing | Details |
|---|---|
| Stores | 8 stores named `[DEMO] ...`, slugs start with `demo-`. Four are in Chennai (Adyar, T. Nagar, Anna Nagar, Velachery), plus Bengaluru, Coimbatore, Hyderabad and Pune. Each has a sample address, postal code and valid coordinates. |
| Owners | One `store_owner` account per store: `demo.owner1@demo.booknest.example` ... `demo.owner8@demo.booknest.example`. Password hashed with the app's own `hashPassword()` (bcrypt). |
| Listings | 12 to 30 **existing** books per store (170 in total), with store-specific prices (about -15% to +20% of the catalog price, rounded to Rs. 5) and quantities from 1 to 20. Second-hand books are not used. |

The same plan is produced every run (it is seeded by each store's slug), so the dry run shows exactly what apply will write.

## What it never does

- Never creates books or changes the catalog (no duplicate titles).
- Never changes anything that already exists: it only runs `INSERT`. There is no `UPDATE` or `DELETE` in it.
- Never touches Savitha's Book Corner, its owner, or its Atomic Habits listing. It only reads them to show them in the report, and checks they are unchanged before saving.
- Never runs migrations or seeds, never touches Redis, never prints `DATABASE_URL` or any password.
- Has no cleanup/delete mode.

## Step 1: dry run (safe, read-only)

From the project root, in PowerShell:

```powershell
npm run demo:stores:dry-run --workspace=server
```

Add `-- --show-books` at the end to list every planned book:

```powershell
npm run demo:stores:dry-run --workspace=server -- --show-books
```

The dry run runs inside a **read-only** database transaction, so the database itself would refuse any write. It prints:

- the database host and name (no username or password),
- the safety checks (schema, unique rules, conflicts, book ids, prices, quantities),
- Savitha's Book Corner and her Atomic Habits listing (so you can confirm the right database),
- each planned store, and
- the exact **host to confirm** for the next step.

If Neon was idle, the first connection can time out after 5 seconds. Just run the command again.

## Step 2: apply (writes records)

Only after you have read the dry-run report. Writing needs all three of:

1. `--apply` (already built into the `demo:stores:apply` script),
2. `--confirm-host=<host>` copied from the dry run, which must match your `DATABASE_URL`,
3. the `DEMO_OWNER_PASSWORD` environment variable (min 10 characters, letters and numbers). It becomes the login password of all 8 demo owners.

```powershell
$env:DEMO_OWNER_PASSWORD = "choose-a-password-with-letters-and-numbers"
npm run demo:stores:apply --workspace=server -- --confirm-host=PASTE-HOST-FROM-DRY-RUN
Remove-Item Env:DEMO_OWNER_PASSWORD
```

The password is only set for that terminal window, is never written to a file, and is never printed. If PowerShell does not pass the flag through, put it in quotes: `"--confirm-host=PASTE-HOST"`.

Everything is written in **one transaction**. If any check fails or anything looks unexpected, the whole run is rolled back and nothing is saved.

## Re-running

Safe. Stores that already exist are reported as `SKIP` and left untouched. If every demo store already exists, it says "Nothing to create". If a slug or e-mail is already used by someone else, it stops with a clear message and writes nothing.

## Verify on the website

1. Wait about a minute. Book pages are cached for 60 seconds.
2. Open **Nearby Bookstores** (`/nearby-stores`). The `[DEMO]` stores are listed with their number of available books.
3. Click **Use my location** (from Chennai the four Chennai stores come first, nearest first), or type "Demo" or a city name in the search.
4. Open a store to see its books with that store's own prices and quantities.
5. Open any stocked book (`/books/<id>`). "Available at stores" should list the demo store with its price.
6. Log in as `demo.owner1@demo.booknest.example` with the password you chose, then open **My Store** to see the store profile and its inventory.

## Verify in the Neon SQL editor (read-only queries)

Demo stores and listings:

```sql
SELECT s.name, s.slug, s.city, count(i.id) AS listings,
       min(i.price) AS min_price, max(i.price) AS max_price
FROM stores s
LEFT JOIN store_book_inventory i ON i.store_id = s.id
WHERE s.slug LIKE 'demo-%'
GROUP BY s.id
ORDER BY s.slug;
```

Savitha's listing is unchanged (should still show 450.00 and 5):

```sql
SELECT b.title, i.price, i.quantity
FROM stores s
JOIN store_book_inventory i ON i.store_id = s.id
JOIN books b ON b.id = i.book_id
WHERE s.name = 'Savitha''s Book Corner' AND b.title ILIKE 'atomic habits%';
```

The catalog was not changed. Run this before and after; the number must be identical:

```sql
SELECT count(*) FROM books;
```

## How demo records are recognised

There is no extra "is_demo" column (that would need a migration). Demo records are recognised by:

- store slug starting with `demo-`,
- store name starting with `[DEMO]`,
- owner e-mail ending in `@demo.booknest.example` (a reserved domain that can never be a real mailbox).

## Common messages

| Message | Meaning |
|---|---|
| `--confirm-host does not match` | You typed a different host than `DATABASE_URL`. Copy it from the dry run. |
| `DEMO_OWNER_PASSWORD is not set` | Set it in the terminal as shown in Step 2. |
| `Table ... does not exist` / `missing column(s)` | The database has not been migrated. Run your normal migration yourself; this script never does. |
| `"Savitha's Book Corner" was not found` | This may be the wrong database. Apply refuses to run. |
| `... already used by a store with a different owner` | A real record uses one of the demo slugs/e-mails. Nothing is written. |
