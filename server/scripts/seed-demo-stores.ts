/**
 * BookNest demo bookstore generator
 * =================================
 * Creates a small set of clearly labelled DEMO bookstores (each with its own
 * store-owner account and a spread of existing catalog books) so the
 * multi-store features can be demonstrated.
 *
 * Usage (run from the project root; see server/scripts/DEMO_STORES.md):
 *
 *   npm run demo:stores:dry-run --workspace=server
 *       Default. Read-only. Prints the plan and the safety checks. Writes nothing.
 *
 *   npm run demo:stores:apply --workspace=server -- --confirm-host=<host from the dry run>
 *       Writes the demo records. Needs BOTH --apply (built into that npm script)
 *       AND --confirm-host, plus the DEMO_OWNER_PASSWORD environment variable.
 *
 * Optional flag: --show-books  (lists every planned listing in the report)
 *
 * What it does NOT do:
 *  - It never runs migrations or seeds, and never creates catalog books.
 *  - It only INSERTs. There is no UPDATE / DELETE code path, so existing users,
 *    stores, inventory, orders, reviews and books cannot be modified.
 *  - It never prints DATABASE_URL, a password, or any other secret.
 *
 * Safe to re-run: a demo store that already exists is skipped untouched. If
 * something looks wrong (a slug or e-mail is already used by someone else, the
 * schema is missing a table, ...) the whole run stops and nothing is written.
 *
 * It reuses the app's own pool (server/src/db/pool.ts, which reads
 * server/.env), hashPassword() (bcrypt) and the store/coordinate validators.
 * Start it from the project root or the server folder so that .env is found.
 */

import type { PoolClient } from "pg";
import { pool, describeDatabaseTarget } from "../src/db/pool";
import { hashPassword } from "../src/utils/password";
import { parseCoordinatePair } from "../src/utils/geo";
import { validateStoreInput } from "../src/utils/validation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Everything this script creates lives in this namespace, so it is easy to recognise. */
const DEMO_SLUG_PREFIX = "demo-";
const DEMO_EMAIL_DOMAIN = "demo.booknest.example"; // ".example" is reserved: can never be a real mailbox
const DEMO_NAME_PREFIX = "[DEMO] ";
const COUNTRY = "India";

const MIN_BOOKS_PER_STORE = 10;
const MAX_BOOKS_PER_STORE = 30;
const MIN_PRICE = 49;
const MAX_PRICE = 100000;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 20;

/** Stops two copies of this script from running at the same time (released automatically at COMMIT/ROLLBACK). */
const ADVISORY_LOCK_KEY = 7340211901;

/** Used only to LOOK AT (never change) the store we promise to protect. */
const PROTECTED_STORE_SLUG = "savitha-book-corner";
const PROTECTED_STORE_NAME = "Savitha's Book Corner";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Demo data (fixed and deterministic: the same plan every run)
// ---------------------------------------------------------------------------

interface DemoStoreDef {
  slug: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  storeEmail: string;
  description: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  latitude: number;
  longitude: number;
  bookCount: number;
}

function makeStore(
  n: number,
  slug: string,
  label: string,
  area: string,
  address: string,
  city: string,
  state: string,
  postalCode: string,
  latitude: number,
  longitude: number,
  bookCount: number
): DemoStoreDef {
  return {
    slug,
    name: `${DEMO_NAME_PREFIX}${label}`,
    ownerName: `Demo Owner ${n} - ${label}`,
    ownerEmail: `demo.owner${n}@${DEMO_EMAIL_DOMAIN}`,
    storeEmail: `demo.store${n}@${DEMO_EMAIL_DOMAIN}`,
    description: `Demo data for the BookNest college project - not a real bookstore. Sample shop in ${area}, ${city}.`,
    address,
    city,
    state,
    postalCode,
    phone: `+91 00000 000${String(n).padStart(2, "0")}`,
    latitude,
    longitude,
    bookCount,
  };
}

function buildDefinitions(): DemoStoreDef[] {
  // Four Chennai stores (so "nearby" search is easy to demo) plus four other cities.
  return [
    makeStore(1, "demo-adyar-reads", "Adyar Reads", "Adyar", "14 Demo Street, Adyar", "Chennai", "Tamil Nadu", "600020", 13.0067, 80.257, 15),
    makeStore(2, "demo-tnagar-bookshelf", "T Nagar Bookshelf", "T. Nagar", "27 Sample Road, T. Nagar", "Chennai", "Tamil Nadu", "600017", 13.0418, 80.2341, 20),
    makeStore(3, "demo-annanagar-pages", "Anna Nagar Pages", "Anna Nagar", "9 Example Avenue, Anna Nagar", "Chennai", "Tamil Nadu", "600040", 13.085, 80.2101, 12),
    makeStore(4, "demo-velachery-book-hub", "Velachery Book Hub", "Velachery", "52 Sample Main Road, Velachery", "Chennai", "Tamil Nadu", "600042", 12.9815, 80.218, 25),
    makeStore(5, "demo-indiranagar-reads", "Indiranagar Reads", "Indiranagar", "31 Demo 100 Feet Road, Indiranagar", "Bengaluru", "Karnataka", "560038", 12.9784, 77.6408, 28),
    makeStore(6, "demo-rs-puram-books", "RS Puram Books", "RS Puram", "18 Sample Cross Cut Road, RS Puram", "Coimbatore", "Tamil Nadu", "641002", 11.007, 76.95, 18),
    makeStore(7, "demo-jubilee-hills-reads", "Jubilee Hills Reads", "Jubilee Hills", "6 Demo Road No. 36, Jubilee Hills", "Hyderabad", "Telangana", "500033", 17.4326, 78.4071, 30),
    makeStore(8, "demo-koregaon-park-books", "Koregaon Park Books", "Koregaon Park", "44 Sample Lane, Koregaon Park", "Pune", "Maharashtra", "411001", 18.5362, 73.894, 22),
  ];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** An error that carries a list of problems, all reported together. */
class PlanError extends Error {
  readonly problems: string[];
  constructor(problems: string[], headline = "Safety checks failed") {
    super(headline);
    this.problems = problems;
  }
}

function collectSecrets(): string[] {
  const secrets: string[] = [];
  const url = process.env.DATABASE_URL;
  if (url) {
    secrets.push(url);
    try {
      const u = new URL(url);
      for (const part of [u.username, u.password]) {
        if (!part) continue;
        secrets.push(part);
        try {
          secrets.push(decodeURIComponent(part));
        } catch {
          /* keep the raw form only */
        }
      }
    } catch {
      /* not a parsable URL: the raw string is still redacted */
    }
  }
  if (process.env.DEMO_OWNER_PASSWORD) secrets.push(process.env.DEMO_OWNER_PASSWORD);
  return secrets.filter((s) => s.length >= 3).sort((a, b) => b.length - a.length);
}

/** Every error message goes through this before it is printed. */
function redact(text: string): string {
  let out = text;
  for (const secret of collectSecrets()) out = out.split(secret).join("[hidden]");
  return out;
}

function getDatabaseHost(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set (the project reads it from server/.env).");
  try {
    const host = new URL(raw).hostname;
    if (!host) throw new Error("empty host");
    return host;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL.");
  }
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic random generator, so the same slug always produces the same plan. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rs = (n: number) => `Rs. ${Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toFixed(2)}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}~` : text);

// ---------------------------------------------------------------------------
// Command line and environment
// ---------------------------------------------------------------------------

interface Options {
  apply: boolean;
  confirmHost: string | null;
  showBooks: boolean;
}

function parseArgs(argv: string[]): Options {
  let apply = false;
  let dryRun = false;
  let showBooks = false;
  let confirmHost: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--show-books") showBooks = true;
    else if (arg.startsWith("--confirm-host=")) confirmHost = arg.slice("--confirm-host=".length).trim();
    else if (arg === "--confirm-host") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("--confirm-host needs a value, e.g. --confirm-host=<host>.");
      confirmHost = next.trim();
      i++;
    } else throw new Error(`Unknown option: ${arg}`);
  }

  if (apply && dryRun) throw new Error("Use either --apply or --dry-run, not both.");
  if (confirmHost !== null && !apply) throw new Error("--confirm-host is only used together with --apply.");
  if (apply && !confirmHost) {
    throw new Error(
      "--apply also needs --confirm-host=<your database host>. Run the dry run first: it prints the exact host to use."
    );
  }
  return { apply, confirmHost, showBooks };
}

/** Only called in apply mode. The password is read from the environment, never from code or files. */
function readOwnerPassword(): string {
  const pw = process.env.DEMO_OWNER_PASSWORD;
  if (!pw) {
    throw new Error(
      "DEMO_OWNER_PASSWORD is not set. Set it in your terminal for this one command (see server/scripts/DEMO_STORES.md)."
    );
  }
  const problems: string[] = [];
  if (pw.length < 10) problems.push("at least 10 characters");
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) problems.push("both letters and numbers");
  if (pw !== pw.trim()) problems.push("no spaces at the start or end");
  if (Buffer.byteLength(pw, "utf8") > 72) problems.push("at most 72 bytes (a bcrypt limit)");
  if (problems.length) throw new Error(`DEMO_OWNER_PASSWORD must have: ${problems.join(", ")}.`);
  return pw;
}

// ---------------------------------------------------------------------------
// Static validation (no database involved)
// ---------------------------------------------------------------------------

function validateDefinitions(defs: DemoStoreDef[]): string[] {
  const problems: string[] = [];
  if (defs.length < 5 || defs.length > 10) problems.push(`Expected 5-10 demo stores, found ${defs.length}.`);

  const slugs = new Set<string>();
  const emails = new Set<string>();

  for (const d of defs) {
    const tag = `[${d.slug}]`;
    if (!SLUG_PATTERN.test(d.slug) || !d.slug.startsWith(DEMO_SLUG_PREFIX)) {
      problems.push(`${tag} slug must be lowercase letters/digits/hyphens and start with "${DEMO_SLUG_PREFIX}".`);
    }
    if (d.slug === PROTECTED_STORE_SLUG) problems.push(`${tag} must never equal the protected store's slug.`);
    if (slugs.has(d.slug)) problems.push(`${tag} slug is used twice in the plan.`);
    slugs.add(d.slug);

    for (const email of [d.ownerEmail, d.storeEmail]) {
      if (!email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) problems.push(`${tag} e-mail ${email} must end with @${DEMO_EMAIL_DOMAIN}.`);
    }
    if (emails.has(d.ownerEmail)) problems.push(`${tag} owner e-mail is used twice in the plan.`);
    emails.add(d.ownerEmail);

    if (!d.name.startsWith(DEMO_NAME_PREFIX)) problems.push(`${tag} name must start with "${DEMO_NAME_PREFIX}".`);

    const limits: Array<[string, string, number]> = [
      ["name", d.name, 160],
      ["slug", d.slug, 160],
      ["store email", d.storeEmail, 160],
      ["owner email", d.ownerEmail, 160],
      ["owner name", d.ownerName, 120],
      ["address", d.address, 255],
      ["city", d.city, 120],
      ["state", d.state, 120],
      ["postal code", d.postalCode, 40],
      ["phone", d.phone, 40],
    ];
    for (const [label, value, max] of limits) {
      if (value.length > max) problems.push(`${tag} ${label} is longer than ${max} characters.`);
    }

    // The same rules the real "create store" endpoint applies.
    const result = validateStoreInput({
      name: d.name,
      slug: d.slug,
      email: d.storeEmail,
      address: d.address,
      city: d.city,
      state: d.state,
      postalCode: d.postalCode,
      country: COUNTRY,
      phone: d.phone,
      description: d.description,
    });
    if (!result.valid) problems.push(`${tag} ${result.errors.join(" ")}`);

    const coords = parseCoordinatePair(d.latitude, d.longitude);
    if (!coords.ok) problems.push(`${tag} ${coords.error}`);
    else if (coords.value === null) problems.push(`${tag} coordinates are required for demo stores.`);

    if (!Number.isInteger(d.bookCount) || d.bookCount < MIN_BOOKS_PER_STORE || d.bookCount > MAX_BOOKS_PER_STORE) {
      problems.push(`${tag} book count must be a whole number from ${MIN_BOOKS_PER_STORE} to ${MAX_BOOKS_PER_STORE}.`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Database access wrapper: enforces "dry run cannot write" and "no UPDATE/DELETE ever"
// ---------------------------------------------------------------------------

const FORBIDDEN_ALWAYS = /\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

class Db {
  constructor(private readonly client: PoolClient, private readonly writable: boolean) {}

  async query(sql: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const first = sql.trim().split(/\s+/)[0].toUpperCase();
    const allowedFirst = this.writable
      ? ["SELECT", "WITH", "INSERT", "BEGIN", "COMMIT", "ROLLBACK", "SET"]
      : ["SELECT", "WITH", "BEGIN", "ROLLBACK", "SET"];
    if (!allowedFirst.includes(first) || FORBIDDEN_ALWAYS.test(sql) || (!this.writable && /\bINSERT\b/i.test(sql))) {
      throw new Error(`Internal safety guard blocked a statement starting with "${first}".`);
    }
    const result = await this.client.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }
}

// ---------------------------------------------------------------------------
// Read-only checks and planning
// ---------------------------------------------------------------------------

const REQUIRED_COLUMNS: Record<string, string[]> = {
  users: ["id", "name", "email", "password_hash", "role"],
  stores: [
    "id", "owner_user_id", "name", "slug", "description", "email", "phone", "address",
    "city", "state", "postal_code", "country", "latitude", "longitude", "is_active",
  ],
  store_book_inventory: ["id", "store_id", "book_id", "quantity", "reserved", "price", "is_active"],
  books: ["id", "title", "price", "is_second_hand"],
};

/** Columns (sorted, comma-joined) that must be covered by a plain UNIQUE constraint/index. */
const REQUIRED_UNIQUE: Record<string, string[]> = {
  users: ["email"],
  stores: ["slug", "owner_user_id"],
  store_book_inventory: ["book_id,store_id"],
};

async function preflightSchema(db: Db): Promise<string[]> {
  const problems: string[] = [];

  const cols = await db.query(
    `SELECT table_name::text AS table_name, column_name::text AS column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)]
  );
  const present = new Map<string, Set<string>>();
  for (const row of cols.rows) {
    if (!present.has(row.table_name)) present.set(row.table_name, new Set());
    present.get(row.table_name)!.add(row.column_name);
  }
  for (const [table, needed] of Object.entries(REQUIRED_COLUMNS)) {
    const have = present.get(table);
    if (!have) {
      problems.push(`Table "${table}" does not exist. Run your normal migrations first (this script never does).`);
      continue;
    }
    const missing = needed.filter((c) => !have.has(c));
    if (missing.length) problems.push(`Table "${table}" is missing column(s): ${missing.join(", ")}. Run your normal migrations first.`);
  }
  if (problems.length) return problems;

  const uniques = await db.query(
    `SELECT t.relname::text AS table_name,
            array_agg(a.attname::text ORDER BY a.attname::text) AS cols
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
      WHERE i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
        AND n.nspname = current_schema()
        AND t.relname IN ('users', 'stores', 'store_book_inventory')
      GROUP BY t.relname, i.indexrelid`
  );
  const haveUnique = new Set<string>(uniques.rows.map((r) => `${r.table_name}:${(r.cols as string[]).join(",")}`));
  for (const [table, keys] of Object.entries(REQUIRED_UNIQUE)) {
    for (const key of keys) {
      if (!haveUnique.has(`${table}:${key}`)) {
        problems.push(`Table "${table}" has no UNIQUE rule on (${key}). Run your normal migrations first.`);
      }
    }
  }

  const checks = await db.query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema() AND t.relname = 'users' AND c.contype = 'c'`
  );
  if (!checks.rows.some((r) => String(r.def).includes("store_owner"))) {
    problems.push(`The users.role check does not allow 'store_owner'. Run your normal migrations first.`);
  }
  return problems;
}

interface CatalogBook {
  id: string;
  title: string;
  price: number;
}

async function loadEligibleBooks(db: Db): Promise<{ books: CatalogBook[]; problems: string[] }> {
  const result = await db.query(
    `SELECT id::text AS id, title, price::text AS price
       FROM books
      WHERE is_second_hand = false AND price > 0`
  );
  const problems: string[] = [];
  const books: CatalogBook[] = [];
  for (const row of result.rows) {
    const price = Number(row.price);
    if (!UUID_PATTERN.test(row.id) || !Number.isFinite(price) || price <= 0) {
      problems.push(`A catalog book has an unexpected id or price: ${String(row.id)}`);
      continue;
    }
    books.push({ id: String(row.id).toLowerCase(), title: String(row.title), price });
  }
  books.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { books, problems };
}

interface PlannedListing {
  bookId: string;
  title: string;
  catalogPrice: number;
  price: number;
  quantity: number;
}

/** Picks the store's books and gives each a store-specific price and quantity. Pure and deterministic. */
function planListings(def: DemoStoreDef, eligible: CatalogBook[]): PlannedListing[] {
  const rand = mulberry32(fnv1a(def.slug));
  const pool_ = eligible.slice();
  const count = Math.min(def.bookCount, pool_.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rand() * (pool_.length - i));
    [pool_[i], pool_[j]] = [pool_[j], pool_[i]];
  }
  const listings: PlannedListing[] = pool_.slice(0, count).map((book) => {
    // Store price: about -15% .. +20% around the catalog price, rounded to the nearest Rs. 5.
    const raw = book.price * (0.85 + rand() * 0.35);
    const price = Math.max(MIN_PRICE, Math.round(raw / 5) * 5);
    // Quantity: some low stock, mostly medium, a few well stocked.
    const roll = rand();
    const quantity =
      roll < 0.2 ? 1 + Math.floor(rand() * 3) : roll < 0.8 ? 4 + Math.floor(rand() * 9) : 13 + Math.floor(rand() * 8);
    return { bookId: book.id, title: book.title, catalogPrice: book.price, price, quantity };
  });
  listings.sort((a, b) => a.title.localeCompare(b.title) || (a.bookId < b.bookId ? -1 : 1));
  return listings;
}

type Action = "CREATE" | "SKIP_EXISTS";

interface StorePlan {
  def: DemoStoreDef;
  action: Action;
  listings: PlannedListing[];
  existingListingCount: number;
}

async function classifyStores(db: Db, defs: DemoStoreDef[]): Promise<{ states: Map<string, { action: Action; existingListings: number }>; conflicts: string[] }> {
  const conflicts: string[] = [];
  const slugs = defs.map((d) => d.slug);
  const emails = defs.map((d) => d.ownerEmail.toLowerCase());

  const users = await db.query(`SELECT id::text AS id, lower(email) AS email, role FROM users WHERE lower(email) = ANY($1::text[])`, [emails]);
  const userByEmail = new Map<string, { id: string; role: string }>();
  for (const u of users.rows) userByEmail.set(u.email, { id: u.id, role: u.role });

  const ownerIds = Array.from(userByEmail.values()).map((u) => u.id);
  const stores = await db.query(
    `SELECT s.id::text AS id, s.slug, s.owner_user_id::text AS owner_user_id
       FROM stores s
      WHERE s.slug = ANY($1::text[]) OR s.owner_user_id = ANY($2::uuid[])`,
    [slugs, ownerIds]
  );
  const storeBySlug = new Map<string, { id: string; owner: string }>();
  const storeByOwner = new Map<string, { id: string; slug: string }>();
  for (const s of stores.rows) {
    storeBySlug.set(s.slug, { id: s.id, owner: s.owner_user_id });
    storeByOwner.set(s.owner_user_id, { id: s.id, slug: s.slug });
  }

  const states = new Map<string, { action: Action; existingListings: number }>();
  const existingStoreIds: string[] = [];

  for (const d of defs) {
    const owner = userByEmail.get(d.ownerEmail.toLowerCase());
    const bySlug = storeBySlug.get(d.slug);
    const tag = `[${d.slug}]`;

    if (!owner && !bySlug) {
      states.set(d.slug, { action: "CREATE", existingListings: 0 });
    } else if (owner && bySlug && bySlug.owner === owner.id && owner.role === "store_owner") {
      states.set(d.slug, { action: "SKIP_EXISTS", existingListings: 0 });
      existingStoreIds.push(bySlug.id);
    } else {
      if (bySlug && !owner) conflicts.push(`${tag} the slug is already used by a store with a different owner.`);
      if (bySlug && owner && bySlug.owner !== owner.id) conflicts.push(`${tag} the slug belongs to a store owned by someone other than ${d.ownerEmail}.`);
      if (owner && owner.role !== "store_owner") conflicts.push(`${tag} ${d.ownerEmail} already exists with role "${owner.role}".`);
      if (owner && !bySlug) {
        const other = storeByOwner.get(owner.id);
        conflicts.push(
          other
            ? `${tag} ${d.ownerEmail} already owns a different store ("${other.slug}"); one store per owner.`
            : `${tag} ${d.ownerEmail} already exists but has no matching store (unexpected partial state).`
        );
      }
    }
  }

  if (existingStoreIds.length) {
    const counts = await db.query(
      `SELECT store_id::text AS store_id, count(*)::int AS n FROM store_book_inventory WHERE store_id = ANY($1::uuid[]) GROUP BY store_id`,
      [existingStoreIds]
    );
    const byStore = new Map<string, number>(counts.rows.map((r) => [r.store_id as string, r.n as number]));
    for (const d of defs) {
      const st = states.get(d.slug);
      const sid = storeBySlug.get(d.slug)?.id;
      if (st && st.action === "SKIP_EXISTS" && sid) st.existingListings = byStore.get(sid) ?? 0;
    }
  }
  return { states, conflicts };
}

interface Counts {
  users: number;
  stores: number;
  listings: number;
}

async function readCounts(db: Db): Promise<Counts> {
  const r = await db.query(
    `SELECT (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM stores) AS stores,
            (SELECT count(*)::int FROM store_book_inventory) AS listings`
  );
  return { users: r.rows[0].users, stores: r.rows[0].stores, listings: r.rows[0].listings };
}

interface ProtectedSnapshot {
  storeName: string;
  listingCount: number;
  fingerprint: string;
  atomicHabits: { price: string; quantity: number } | null;
}

/** Read-only look at the store we promise not to touch. The fingerprint is compared again before COMMIT. */
async function readProtectedStore(db: Db): Promise<ProtectedSnapshot | null> {
  const r = await db.query(
    `SELECT s.id::text AS store_id, s.name AS store_name,
            md5(s::text) AS store_md5,
            (SELECT md5(coalesce(u::text, '')) FROM users u WHERE u.id = s.owner_user_id) AS owner_md5,
            (SELECT count(*)::int FROM store_book_inventory i WHERE i.store_id = s.id) AS listing_count,
            (SELECT md5(coalesce(string_agg(i::text, '|' ORDER BY i.id::text), ''))
               FROM store_book_inventory i WHERE i.store_id = s.id) AS inventory_md5
       FROM stores s
      WHERE s.slug = $1 OR s.name = $2
      ORDER BY (s.slug = $1) DESC, s.created_at
      LIMIT 1`,
    [PROTECTED_STORE_SLUG, PROTECTED_STORE_NAME]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const ah = await db.query(
    `SELECT i.price::text AS price, i.quantity
       FROM store_book_inventory i
       JOIN books b ON b.id = i.book_id
      WHERE i.store_id = $1::uuid AND b.title ILIKE 'atomic habits%'
      ORDER BY b.title
      LIMIT 1`,
    [row.store_id]
  );
  return {
    storeName: row.store_name,
    listingCount: row.listing_count,
    fingerprint: `${row.store_md5}|${row.owner_md5}|${row.inventory_md5}`,
    atomicHabits: ah.rows.length ? { price: ah.rows[0].price, quantity: ah.rows[0].quantity } : null,
  };
}

interface PlanResult {
  plans: StorePlan[];
  eligibleCount: number;
  counts: Counts;
  protectedStore: ProtectedSnapshot | null;
}

function validatePlan(plans: StorePlan[], eligible: CatalogBook[]): string[] {
  const problems: string[] = [];
  const known = new Set(eligible.map((b) => b.id));
  for (const plan of plans) {
    if (plan.action !== "CREATE") continue;
    const tag = `[${plan.def.slug}]`;
    if (plan.listings.length !== plan.def.bookCount) {
      problems.push(`${tag} planned ${plan.listings.length} books but ${plan.def.bookCount} were expected.`);
    }
    const seen = new Set<string>();
    for (const l of plan.listings) {
      if (!UUID_PATTERN.test(l.bookId) || !known.has(l.bookId)) problems.push(`${tag} unknown book id ${l.bookId}.`);
      if (seen.has(l.bookId)) problems.push(`${tag} book ${l.bookId} is planned twice.`);
      seen.add(l.bookId);
      const cents = l.price * 100;
      if (!Number.isFinite(l.price) || l.price < MIN_PRICE || l.price > MAX_PRICE || Math.abs(cents - Math.round(cents)) > 1e-6) {
        problems.push(`${tag} invalid price ${l.price} for book ${l.bookId}.`);
      }
      if (!Number.isInteger(l.quantity) || l.quantity < MIN_QUANTITY || l.quantity > MAX_QUANTITY) {
        problems.push(`${tag} invalid quantity ${l.quantity} for book ${l.bookId}.`);
      }
    }
  }
  return problems;
}

async function buildPlan(db: Db, defs: DemoStoreDef[]): Promise<PlanResult> {
  const schemaProblems = await preflightSchema(db);
  if (schemaProblems.length) throw new PlanError(schemaProblems, "The database schema is not ready");

  const problems: string[] = [];
  const { books: eligible, problems: catalogProblems } = await loadEligibleBooks(db);
  problems.push(...catalogProblems);
  const needed = Math.max(...defs.map((d) => d.bookCount));
  if (eligible.length < needed) {
    problems.push(`Only ${eligible.length} eligible catalog books exist (non-second-hand, price > 0); at least ${needed} are needed.`);
  }

  const { states, conflicts } = await classifyStores(db, defs);
  problems.push(...conflicts);

  const plans: StorePlan[] = defs.map((def) => {
    const st = states.get(def.slug);
    const action: Action = st ? st.action : "CREATE";
    return {
      def,
      action,
      listings: action === "CREATE" && eligible.length >= needed ? planListings(def, eligible) : [],
      existingListingCount: st ? st.existingListings : 0,
    };
  });
  if (!problems.length) problems.push(...validatePlan(plans, eligible));
  if (problems.length) throw new PlanError(problems);

  const counts = await readCounts(db);
  const protectedStore = await readProtectedStore(db);
  return { plans, eligibleCount: eligible.length, counts, protectedStore };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(result: PlanResult, options: Options, host: string): void {
  const { plans, eligibleCount, counts, protectedStore } = result;
  const creates = plans.filter((p) => p.action === "CREATE");
  const skips = plans.filter((p) => p.action === "SKIP_EXISTS");
  const totalListings = creates.reduce((sum, p) => sum + p.listings.length, 0);

  console.log("");
  console.log("Safety checks passed: schema, unique rules, name/e-mail/slug conflicts, book ids, prices, quantities.");
  console.log(`Database now: ${counts.users} users, ${counts.stores} stores, ${counts.listings} store listings.`);
  console.log(`Catalog: ${eligibleCount} eligible books (not second-hand, price above 0). No books are created.`);
  console.log("");
  console.log("Protected (read only, never changed):");
  if (protectedStore) {
    const ah = protectedStore.atomicHabits
      ? `Atomic Habits at ${rs(Number(protectedStore.atomicHabits.price))}, quantity ${protectedStore.atomicHabits.quantity}`
      : "no Atomic Habits listing found";
    console.log(`  ${protectedStore.storeName}: ${protectedStore.listingCount} listings; ${ah}.`);
  } else {
    console.log(`  WARNING: "${PROTECTED_STORE_NAME}" was not found. This may be the wrong database; --apply will refuse to run.`);
  }
  console.log("");

  plans.forEach((p, i) => {
    const d = p.def;
    console.log(`${i + 1}) ${d.name}  ->  ${p.action === "CREATE" ? "CREATE" : "SKIP (already exists, left untouched)"}`);
    console.log(`   slug: ${d.slug}   owner: ${d.ownerEmail}`);
    console.log(`   ${d.address}, ${d.city}, ${d.state} ${d.postalCode}   (${d.latitude}, ${d.longitude})`);
    if (p.action === "CREATE") {
      const prices = p.listings.map((l) => l.price);
      const qtys = p.listings.map((l) => l.quantity);
      const copies = qtys.reduce((a, b) => a + b, 0);
      console.log(
        `   ${p.listings.length} books, store prices ${rs(Math.min(...prices))} - ${rs(Math.max(...prices))}, quantity ${Math.min(...qtys)} - ${Math.max(...qtys)} (${copies} copies)`
      );
      if (options.showBooks) {
        for (const l of p.listings) {
          console.log(`     - ${clip(l.title, 44).padEnd(44)} catalog ${rs(l.catalogPrice).padStart(10)}  store ${rs(l.price).padStart(10)}  qty ${l.quantity}`);
        }
      }
    } else {
      console.log(`   existing store has ${p.existingListingCount} listings (not modified)`);
    }
  });

  console.log("");
  console.log(`Totals: ${creates.length} owner accounts + ${creates.length} stores + ${totalListings} listings to create; ${skips.length} store(s) skipped.`);
  console.log(`Host to confirm when applying: ${host}`);
}

// ---------------------------------------------------------------------------
// Apply (writes). Everything below runs inside ONE transaction.
// ---------------------------------------------------------------------------

async function writePlan(db: Db, result: PlanResult, ownerPassword: string): Promise<void> {
  const creates = result.plans.filter((p) => p.action === "CREATE");

  for (const plan of creates) {
    const d = plan.def;
    const passwordHash = await hashPassword(ownerPassword); // bcrypt via the app's own utility

    const user = await db.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'store_owner')
       ON CONFLICT (email) DO NOTHING
       RETURNING id::text AS id`,
      [d.ownerName, d.ownerEmail.toLowerCase(), passwordHash]
    );
    if (user.rowCount !== 1) throw new Error(`[${d.slug}] owner account was not created (the e-mail appeared meanwhile).`);

    const store = await db.query(
      `INSERT INTO stores (owner_user_id, name, slug, description, email, phone, address, city, state, postal_code, country, latitude, longitude, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
       ON CONFLICT DO NOTHING
       RETURNING id::text AS id`,
      [user.rows[0].id, d.name, d.slug, d.description, d.storeEmail, d.phone, d.address, d.city, d.state, d.postalCode, COUNTRY, d.latitude, d.longitude]
    );
    if (store.rowCount !== 1) throw new Error(`[${d.slug}] store was not created (the slug or owner appeared meanwhile).`);

    const inventory = await db.query(
      `INSERT INTO store_book_inventory (store_id, book_id, quantity, reserved, price, is_active)
       SELECT $1::uuid, t.book_id, t.quantity, 0, t.price, true
         FROM unnest($2::uuid[], $3::int[], $4::numeric[]) AS t(book_id, quantity, price)
       ON CONFLICT (store_id, book_id) DO NOTHING
       RETURNING id::text AS id`,
      [store.rows[0].id, plan.listings.map((l) => l.bookId), plan.listings.map((l) => l.quantity), plan.listings.map((l) => l.price)]
    );
    if (inventory.rowCount !== plan.listings.length) {
      throw new Error(`[${d.slug}] expected ${plan.listings.length} listings but inserted ${inventory.rowCount}.`);
    }
  }

  // Final checks, still inside the transaction: if anything differs, the caller rolls everything back.
  const created = creates.length;
  const listings = creates.reduce((sum, p) => sum + p.listings.length, 0);
  const after = await readCounts(db);
  const before = result.counts;
  if (after.users !== before.users + created || after.stores !== before.stores + created || after.listings !== before.listings + listings) {
    throw new Error("Row counts after writing do not match the plan (the database may have changed during the run). Nothing was saved.");
  }
  const protectedAfter = await readProtectedStore(db);
  if (!result.protectedStore || !protectedAfter || protectedAfter.fingerprint !== result.protectedStore.fingerprint) {
    throw new Error(`"${PROTECTED_STORE_NAME}" appears to have changed during the run. Nothing was saved.`);
  }
}

async function rollbackQuietly(db: Db): Promise<void> {
  try {
    await db.query("ROLLBACK");
  } catch {
    /* the connection may already be gone; nothing was committed either way */
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const defs = buildDefinitions();
  const defProblems = validateDefinitions(defs);
  if (defProblems.length) throw new PlanError(defProblems, "The built-in demo store definitions are invalid");

  const host = getDatabaseHost();
  let ownerPassword: string | null = null;
  if (options.apply) {
    if (options.confirmHost!.toLowerCase() !== host.toLowerCase()) {
      throw new Error("--confirm-host does not match the host in DATABASE_URL. Run the dry run: it prints the exact host to use.");
    }
    ownerPassword = readOwnerPassword();
  }

  console.log(options.apply ? "BookNest demo stores - APPLY (records will be written)" : "BookNest demo stores - DRY RUN (read-only, nothing will be written)");
  console.log(`Target database: ${describeDatabaseTarget()}`);

  const client = await pool.connect();
  const db = new Db(client, options.apply);
  try {
    if (!options.apply) {
      // The database itself refuses any write inside a READ ONLY transaction.
      await db.query("BEGIN READ ONLY");
      try {
        await db.query("SET LOCAL statement_timeout = 60000");
        const result = await buildPlan(db, defs);
        printReport(result, options, host);
        console.log("");
        console.log("Dry run complete. No changes were made.");
      } finally {
        await rollbackQuietly(db);
      }
      return;
    }

    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL lock_timeout = 10000");
      await db.query("SET LOCAL statement_timeout = 60000");
      await db.query(`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

      const result = await buildPlan(db, defs);
      if (!result.protectedStore) {
        throw new PlanError([`"${PROTECTED_STORE_NAME}" was not found, so this may not be the right database.`]);
      }
      printReport(result, options, host);

      const creates = result.plans.filter((p) => p.action === "CREATE");
      if (creates.length === 0) {
        await db.query("ROLLBACK");
        console.log("");
        console.log("Nothing to create: every demo store already exists. No changes were made.");
        return;
      }

      await writePlan(db, result, ownerPassword!);
      await db.query("COMMIT");

      console.log("");
      console.log(`Done. Created ${creates.length} demo stores with their owner accounts and listings.`);
      console.log("Demo owner logins (password = the DEMO_OWNER_PASSWORD you set):");
      for (const p of creates) console.log(`  ${p.def.ownerEmail}   (${p.def.name})`);
      console.log("Book pages may take up to about a minute to show the new stores (they are cached).");
    } catch (err) {
      await rollbackQuietly(db);
      throw err;
    }
  } finally {
    client.release();
  }
}

main()
  .catch((err: unknown) => {
    console.error("");
    if (err instanceof PlanError) {
      console.error(`ERROR: ${err.message}. Nothing was written.`);
      for (const problem of err.problems) console.error(`  - ${redact(problem)}`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === "object" && "code" in err ? ` (code ${String((err as { code: unknown }).code)})` : "";
      console.error(`ERROR: ${redact(message)}${code}. Nothing was written.`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
