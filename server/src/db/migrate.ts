import fs from "fs";
import path from "path";
import { pool, describeDatabaseTarget } from "./pool";

// Base schema, then any phase-specific ALTER migrations, applied in order.
// Each file is idempotent (IF NOT EXISTS / DROP ... IF EXISTS) so re-running
// this script on an already-migrated database is safe.
//
// Order was checked against the SQL: phase3t5 (new book_request tables, needs
// users + stores) and phase3t2 (new orders columns) do not depend on each
// other, and phase3t7 (stores constraints/index) needs phase1f. Keep this order.
const MIGRATION_FILES = [
  "schema.sql",
  "migrations_phase1d.sql",
  "migrations_phase1e.sql",
  "migrations_phase1f.sql",
  "migrations_phase2a.sql",
  "migrations_phase2b.sql",
  "migrations_phase2c.sql",
  "migrations_phase3t5.sql",
  "migrations_phase3t2.sql",
  "migrations_phase3t7.sql",
];

/**
 * Finds the folder that actually holds the .sql files. tsc does not copy .sql
 * into dist/, so when running compiled code (dist/db) we fall back to src/db.
 */
function resolveSqlDir(): string {
  const candidates = [__dirname, path.resolve(__dirname, "../../src/db")];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, MIGRATION_FILES[0]))) return dir;
  }
  throw new Error(
    `Cannot find ${MIGRATION_FILES[0]}. Looked in:\n  ${candidates.join("\n  ")}`
  );
}

/** Throws (before touching the database) if the file list and folder disagree. */
function verifyMigrationFiles(dir: string): void {
  const missing = MIGRATION_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) {
    throw new Error(`Required migration file(s) missing in ${dir}: ${missing.join(", ")}`);
  }
  const unlisted = fs
    .readdirSync(dir)
    .filter((f) => /^migrations_.*\.sql$/.test(f) && !MIGRATION_FILES.includes(f));
  if (unlisted.length) {
    throw new Error(
      `Migration file(s) exist but are not in MIGRATION_FILES: ${unlisted.join(", ")}. Add them in the correct order.`
    );
  }
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    // pool.ts loads dotenv on import, so this checks the final value.
    throw new Error("DATABASE_URL is not set.");
  }
  console.log(`Target database: ${describeDatabaseTarget()}`);
  const dir = resolveSqlDir();
  verifyMigrationFiles(dir); // nothing is skipped silently: all files exist or we stop

  for (const file of MIGRATION_FILES) {
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    console.log(`${file} applied successfully.`);
  }
  await pool.end();
}

migrate().catch(async (err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
