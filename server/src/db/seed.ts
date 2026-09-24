import fs from "fs";
import path from "path";
import { pool } from "./pool";
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

// Run in order: base data, extra books, then cover/price fixes.
const SEED_FILES = ["seed.sql", "add_more_books.sql", "fix_covers.sql", "fix_prices.sql"];

async function seed() {
  console.log("Seeding database...");
  for (const file of SEED_FILES) {
    const filePath = path.join(__dirname, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    await pool.query(sql);
    console.log(`${file} applied.`);
  }
  await seedDemoAccounts();
  console.log("Seed data inserted successfully.");

  await pool.end();
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
