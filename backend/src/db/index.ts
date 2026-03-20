import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DbStatement = {
  run: (...params: unknown[]) => void;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
};

export type DbWrapper = {
  prepare: (sql: string) => DbStatement;
  exec: (sql: string) => void;
  /** Returns a function; call it to run the transaction. */
  transaction: (fn: () => void) => () => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;
let dbPath: string = "";
let inTransaction = false;

function save(): void {
  if (!db || !dbPath) return;
  const data = db.export();
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(dbPath, Buffer.from(data));
}

function createStatement(sql: string): DbStatement {
  if (!db) throw new Error("Database not initialized");
  const stmt = db.prepare(sql);
  const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql.trim());
  return {
    run(...params: unknown[]) {
      stmt.bind(params as number[]);
      stmt.step();
      stmt.reset();
      if (isWrite && !inTransaction) save();
    },
    get(...params: unknown[]) {
      stmt.bind(params as number[]);
      const hasRow = stmt.step();
      const row = hasRow ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
      stmt.reset();
      return row;
    },
    all(...params: unknown[]) {
      stmt.bind(params as number[]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
      stmt.reset();
      return rows;
    },
  };
}

function wrap(dbInstance: { run: (sql: string) => void }): DbWrapper {
  return {
    prepare(sql: string) {
      return createStatement(sql);
    },
    exec(sql: string) {
      dbInstance.run(sql);
    },
    transaction(fn: () => void) {
      return () => {
        dbInstance.run("BEGIN");
        inTransaction = true;
        try {
          fn();
          dbInstance.run("COMMIT");
          save();
        } catch (e) {
          try {
            dbInstance.run("ROLLBACK");
          } catch {
            // Transaction may already be rolled back by sql.js on error
          }
          throw e;
        } finally {
          inTransaction = false;
        }
      };
    },
  };
}

let wrapper: DbWrapper | null = null;

function runSchema(database: { exec: (sql: string) => void }): void {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  database.exec(sql);
}

export async function initDb(): Promise<void> {
  if (db) return;
  const SQL = await initSqlJs();
  dbPath =
    config.dbPath && path.isAbsolute(config.dbPath)
      ? config.dbPath
      : path.resolve(process.cwd(), config.dbPath);
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const buffer = existsSync(dbPath)
    ? readFileSync(dbPath)
    : undefined;
  db = new SQL.Database(buffer);
  runSchema(db);
  try {
    db.run("ALTER TABLE rooms ADD COLUMN turn_started_at TEXT");
  } catch {
    // Column already exists (e.g. new schema)
  }
  try {
    db.run("ALTER TABLE events ADD COLUMN popularity_score INTEGER");
  } catch {
    // Column already exists (e.g. new schema)
  }
  try {
    db.run("ALTER TABLE room_players ADD COLUMN avatar TEXT");
  } catch {
    // Column already exists (e.g. new schema)
  }
  try {
    db.run("ALTER TABLE events ADD COLUMN refreshed_at TEXT");
  } catch {
    // Column already exists (e.g. new schema)
  }
  try {
    db.run("ALTER TABLE events ADD COLUMN created_at TEXT");
  } catch {
    // Column already exists (e.g. new schema)
  }
  try {
    db.run(
      "UPDATE events SET created_at = COALESCE(created_at, refreshed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE created_at IS NULL OR created_at = ''",
    );
  } catch {
    // ignore
  }
  if (!buffer) save();
  wrapper = wrap(db);
}

export function getDb(): DbWrapper {
  if (!wrapper) throw new Error("Database not initialized. Call initDb() first.");
  return wrapper;
}

export function closeDb(): void {
  if (db) {
    save();
    db.close();
    db = null;
    wrapper = null;
  }
}
