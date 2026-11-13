import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const migrationDir = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(46192012)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations
      (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(migrationDir)).filter(f => /^\d+.*\.sql$/.test(f)).sort();
    for (const file of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file]);
      if (existing.rowCount) continue;
      const sql = await readFile(fileURLToPath(new URL(file, new URL("../migrations/", import.meta.url))), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
      console.info("Applied migration", file);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
