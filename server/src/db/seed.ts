import fs from "fs";
import path from "path";
import { pool, describeDatabaseTarget } from "./pool";
import { hashPassword } from "../utils/password";

async function seedDemoAccounts() {
  const accounts = [
    { name: "Demo Customer", email: "customer@booknest.com", password: "Customer@123", role: "customer" },
    { name: "Demo Admin", email: "admin@booknest.com", password: "Admin@123", role: "admin" },
  ];

  for (const acc of accounts) {
    const passwordHash = await hashPassword(acc.password);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [acc.name, acc.email, passwordHash, acc.role]
    );
  }
  console.log("Demo accounts seeded: customer@booknest.com / admin@booknest.com");
}


// Demo bookstores so every book is available at several stores.
// One store per owner (DB constraint), so each store gets its own owner account.
const STORE_OWNER_PASSWORD = "StoreOwner@123";
const DEMO_STORES = [
  { owner: "Savitha Raman", email: "savitha@booknest.com", name: "Savitha's Book Corner", slug: "savitha-book-corner", city: "Chennai", state: "Tamil Nadu", postal: "600020", address: "12 Besant Nagar Main Rd", phone: "+91 44 5550 0101", lat: 13.0002, lng: 80.2668 },
  { owner: "Ravi Kumar", email: "ravi@booknest.com", name: "Ravi's Book Corner", slug: "ravi-book-corner", city: "Bengaluru", state: "Karnataka", postal: "560001", address: "45 Church Street", phone: "+91 80 5550 0102", lat: 12.9753, lng: 77.6067 },
  { owner: "Meera Iyer", email: "meera@booknest.com", name: "Pages & Chai", slug: "pages-and-chai", city: "Mumbai", state: "Maharashtra", postal: "400050", address: "7 Linking Road, Bandra West", phone: "+91 22 5550 0103", lat: 19.0596, lng: 72.8295 },
  { owner: "Arjun Mehta", email: "arjun@booknest.com", name: "The Reading Room", slug: "the-reading-room", city: "New Delhi", state: "Delhi", postal: "110001", address: "18 Khan Market", phone: "+91 11 5550 0104", lat: 28.6003, lng: 77.2268 },
  { owner: "Kavya Reddy", email: "kavya@booknest.com", name: "Bookworm Hyderabad", slug: "bookworm-hyderabad", city: "Hyderabad", state: "Telangana", postal: "500034", address: "22 Road No. 12, Banjara Hills", phone: "+91 40 5550 0105", lat: 17.4126, lng: 78.4482 },
  { owner: "Nikhil Joshi", email: "nikhil@booknest.com", name: "Shelf Life Books", slug: "shelf-life-books", city: "Pune", state: "Maharashtra", postal: "411001", address: "9 FC Road", phone: "+91 20 5550 0106", lat: 18.5204, lng: 73.8567 },
  { owner: "Arindam Sen", email: "arindam@booknest.com", name: "College Street Collective", slug: "college-street-collective", city: "Kolkata", state: "West Bengal", postal: "700073", address: "15 College Street", phone: "+91 33 5550 0107", lat: 22.5744, lng: 88.3629 },
  { owner: "Anjali Nair", email: "anjali@booknest.com", name: "Backwater Books", slug: "backwater-books", city: "Kochi", state: "Kerala", postal: "682016", address: "8 MG Road, Ernakulam", phone: "+91 484 555 0108", lat: 9.9816, lng: 76.2999 },
  { owner: "Rohan Shekhawat", email: "rohan@booknest.com", name: "Pink City Books", slug: "pink-city-books", city: "Jaipur", state: "Rajasthan", postal: "302001", address: "21 MI Road", phone: "+91 141 555 0109", lat: 26.9157, lng: 75.8091 },
  { owner: "Lakshmi Narayanan", email: "lakshmi@booknest.com", name: "Kovai Book House", slug: "kovai-book-house", city: "Coimbatore", state: "Tamil Nadu", postal: "641001", address: "30 Race Course Road", phone: "+91 422 555 0110", lat: 11.0003, lng: 76.9711 },
  { owner: "Gayathri Subramanian", email: "gayathri@booknest.com", name: "Mylapore Book House", slug: "mylapore-book-house", city: "Chennai", state: "Tamil Nadu", postal: "600004", address: "34 Luz Church Road, Mylapore", phone: "+91 44 5550 0111", lat: 13.0339, lng: 80.2619 },
  { owner: "Muthu Pandian", email: "muthu@booknest.com", name: "Koodal Books", slug: "koodal-books", city: "Madurai", state: "Tamil Nadu", postal: "625001", address: "12 West Masi Street", phone: "+91 452 555 0112", lat: 9.9195, lng: 78.1193 },
  { owner: "Deepa Balasubramanian", email: "deepa@booknest.com", name: "Rock Fort Reads", slug: "rock-fort-reads", city: "Tiruchirappalli", state: "Tamil Nadu", postal: "620008", address: "5 Big Bazaar Street", phone: "+91 431 555 0113", lat: 10.8050, lng: 78.6856 },
  { owner: "Hardik Patel", email: "hardik@booknest.com", name: "Sabarmati Books", slug: "sabarmati-books", city: "Ahmedabad", state: "Gujarat", postal: "380009", address: "17 CG Road", phone: "+91 79 5550 0114", lat: 23.0225, lng: 72.5714 },
  { owner: "Simran Kaur", email: "simran@booknest.com", name: "The Book Nook", slug: "the-book-nook-chandigarh", city: "Chandigarh", state: "Chandigarh", postal: "160017", address: "SCO 22, Sector 17", phone: "+91 172 555 0115", lat: 30.7333, lng: 76.7794 },
];

async function seedDemoStores() {
  const passwordHash = await hashPassword(STORE_OWNER_PASSWORD);
  for (const s of DEMO_STORES) {
    const user = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'store_owner')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [s.owner, s.email, passwordHash]
    );
    await pool.query(
      `INSERT INTO stores (owner_user_id, name, slug, description, email, phone, address, city, state, postal_code, country, latitude, longitude, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'India', $11, $12, true)
       ON CONFLICT (slug) DO NOTHING`,
      [user.rows[0].id, s.name, s.slug, `Independent bookstore in ${s.city}.`, s.email, s.phone, s.address, s.city, s.state, s.postal, s.lat, s.lng]
    );
  }

  // Every book is listed at 4 stores (rotating), plus ~30% extra listings at other stores.
  // Price varies about -12% to +12% around the catalog price; quantity 2-14.
  // Existing listings are never overwritten, so re-running only fills in gaps.
  const result = await pool.query(
    `WITH demo_stores AS (
       SELECT id, row_number() OVER (ORDER BY slug) - 1 AS sn
       FROM stores WHERE slug = ANY($1::text[])
     ),
     n AS (SELECT count(*)::int AS cnt FROM demo_stores),
     all_books AS (
       SELECT id, price, row_number() OVER (ORDER BY isbn) - 1 AS bn FROM books WHERE is_second_hand = false
     )
     INSERT INTO store_book_inventory (store_id, book_id, quantity, reserved, price, is_active)
     SELECT s.id, b.id,
            2 + (abs(hashtext(s.id::text || b.id::text)::bigint) % 13),
            0,
            GREATEST(99, ROUND(b.price * (0.88 + (abs(hashtext(b.id::text || s.id::text)::bigint) % 25) / 100.0))),
            true
     FROM all_books b
     CROSS JOIN demo_stores s
     CROSS JOIN n
     WHERE (((s.sn - b.bn) % n.cnt) + n.cnt) % n.cnt < 4
        OR abs(hashtext(s.id::text || b.id::text || 'x')::bigint) % 100 < 30
     ON CONFLICT (store_id, book_id) DO NOTHING`,
    [DEMO_STORES.map((s) => s.slug)]
  );
  console.log(`Demo stores seeded (${DEMO_STORES.length} stores, ${result.rowCount} new listings). Store owners: <name>@booknest.com / ${STORE_OWNER_PASSWORD}`);
}

// Run in order: base data, extra books, then cover/price fixes.
const SEED_FILES = [
  "seed.sql",
  "add_more_books.sql",
  "add_more_books_2.sql",
  "add_more_books_3.sql",
  "add_more_books_4.sql",
  "fix_covers.sql",
  "fix_prices.sql",
  "add_second_hand_books.sql",
];

// Demo accounts use publicly documented passwords, so they must never be
// created (or have their password reset) on a live database.
function assertDemoAccountsAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to create demo accounts: NODE_ENV=production. Use `npm run db:seed:catalog` (books only) instead."
    );
  }
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL || "").hostname;
  } catch {
    throw new Error("DATABASE_URL is missing or not a valid URL.");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];
  if (!local.includes(host) && process.env.ALLOW_DEMO_SEED_REMOTE !== "true") {
    throw new Error(
      `Refusing to create demo accounts on non-local database host "${host}". Use \`npm run db:seed:catalog\` (books only).`
    );
  }
}

async function seed() {
  const catalogOnly = process.argv.includes("--catalog-only");
  console.log(`Target database: ${describeDatabaseTarget()}`);
  if (!catalogOnly) assertDemoAccountsAllowed(); // before any query runs
  console.log(catalogOnly ? "Seeding catalog only (no demo accounts)..." : "Seeding database...");
  for (const file of SEED_FILES) {
    const filePath = path.join(__dirname, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    await pool.query(sql);
    console.log(`${file} applied.`);
  }
  if (!catalogOnly) {
    await seedDemoAccounts();
    await seedDemoStores();
  }
  console.log("Seed data inserted successfully.");

  await pool.end();
}

seed().catch((err) => {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});