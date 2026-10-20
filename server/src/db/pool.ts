import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error", err);
});

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW()");
    console.log("PostgreSQL connected at:", result.rows[0].now);
  } finally {
    client.release();
  }
}

/**
 * "host / database" of the configured DATABASE_URL, for log lines. Never includes
 * the user name, password or query string. Lets you see which database a
 * migration or seed is about to touch.
 */
export function describeDatabaseTarget(): string {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    return `${u.hostname}${u.port ? ":" + u.port : ""} / ${decodeURIComponent(u.pathname.replace(/^\//, ""))}`;
  } catch {
    return "(DATABASE_URL missing or not a valid URL)";
  }
}
