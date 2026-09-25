import fs from "fs";
import path from "path";
import { pool } from "./pool";

// Base schema, then any phase-specific ALTER migrations, applied in order.
// Each file is idempotent (IF NOT EXISTS / DROP ... IF EXISTS) so re-running
// this script on an already-migrated database is safe.
const MIGRATION_FILES = [
  "schema.sql",
  "migrations_phase1d.sql",
  "migrations_phase1e.sql",
  "migrations_phase1f.sql",
  "migrations_phase2a.sql",
];

async function migrate() {
  for (const file of MIGRATION_FILES) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${file} (not found).`);
      continue;
    }
    const sql = fs.readFileSync(filePath, "utf-8");
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    console.log(`${file} applied successfully.`);
  }

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
