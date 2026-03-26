import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";

type PoolClient = pg.PoolClient;

let pool: pg.Pool | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Convert `?` placeholders to PostgreSQL `$1`, `$2`, ... */
export function q(sql: string, params: unknown[]): { text: string; values: unknown[] } {
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
  if (i !== params.length) {
    throw new Error(
      `SQL placeholder count (${i}) !== params (${params.length}): ${sql.slice(0, 120)}`,
    );
  }
  return { text, values: params };
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error("Database not initialized. Call initDb() first.");
  return pool;
}

export async function queryRows<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { text, values } = q(sql, params);
  const res = await getPool().query(text, values);
  return res.rows as T[];
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryRows<T>(sql, params);
  return rows[0];
}

export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  const { text, values } = q(sql, params);
  await getPool().query(text, values);
}

export async function execClient(client: pg.PoolClient, sql: string, params: unknown[] = []): Promise<void> {
  const { text, values } = q(sql, params);
  await client.query(text, values);
}

export async function queryRowsClient<T extends Record<string, unknown>>(
  client: pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { text, values } = q(sql, params);
  const res = await client.query(text, values);
  return res.rows as T[];
}

export async function queryOneClient<T extends Record<string, unknown>>(
  client: pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryRowsClient<T>(client, sql, params);
  return rows[0];
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** COUNT(*) etc. may arrive as string from pg */
export function rowCount(row: { count?: unknown; c?: unknown } | undefined, key: "count" | "c" = "count"): number {
  const v = row?.[key];
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v) || 0;
}

async function runSchemaFromFile(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema.pg.sql");
  let sql = readFileSync(schemaPath, "utf8");
  sql = sql.replace(/^--[^\n]*$/gm, "");
  const parts = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const client = await getPool().connect();
  try {
    for (const part of parts) {
      await client.query(`${part};`);
    }
  } finally {
    client.release();
  }
}

/**
 * Connect pool and optionally create tables (when DATABASE_AUTO_MIGRATE=1 or tables missing).
 */
export async function initDb(): Promise<void> {
  if (pool) return;
  if (!config.databaseUrl?.trim()) {
    throw new Error(
      "DATABASE_URL is required. Use your Supabase project: Settings → Database → Connection string (URI), mode Transaction or Session.",
    );
  }
  const newPool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.PG_POOL_MAX) || 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool = newPool;

  const client = await newPool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }

  const reg = await queryOne<{ reg: string | null }>(
    "SELECT to_regclass('public.events')::text as reg",
    [],
  );
  const forceMigrate =
    process.env.DATABASE_AUTO_MIGRATE === "1" || process.env.DATABASE_AUTO_MIGRATE === "true";
  if (!reg?.reg || forceMigrate) {
    if (!reg?.reg) {
      console.log("[db] public.events missing — applying schema.pg.sql...");
    } else {
      console.log("[db] DATABASE_AUTO_MIGRATE=1 — re-applying schema.pg.sql (idempotent)...");
    }
    await runSchemaFromFile();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

