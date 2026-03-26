/**
 * Apply schema.pg.sql to DATABASE_URL (Supabase SQL editor is an alternative).
 * Usage: DATABASE_URL=... npm run db:migrate
 */
import dotenv from "dotenv";
dotenv.config();

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "../src/db/schema.pg.sql");

async function main(): Promise<void> {
  let sql = readFileSync(schemaPath, "utf8");
  sql = sql.replace(/^--[^\n]*$/gm, "");
  const parts = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  try {
    for (const part of parts) {
      await client.query(`${part};`);
    }
    console.log(`Applied ${parts.length} statements from schema.pg.sql`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
