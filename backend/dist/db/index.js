import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db = null;
let dbPath = "";
let inTransaction = false;
function save() {
    if (!db || !dbPath)
        return;
    const data = db.export();
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(dbPath, Buffer.from(data));
}
function createStatement(sql) {
    if (!db)
        throw new Error("Database not initialized");
    const stmt = db.prepare(sql);
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql.trim());
    return {
        run(...params) {
            stmt.bind(params);
            stmt.step();
            stmt.reset();
            if (isWrite && !inTransaction)
                save();
        },
        get(...params) {
            stmt.bind(params);
            const hasRow = stmt.step();
            const row = hasRow ? stmt.getAsObject() : undefined;
            stmt.reset();
            return row;
        },
        all(...params) {
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            stmt.reset();
            return rows;
        },
    };
}
function wrap(dbInstance) {
    return {
        prepare(sql) {
            return createStatement(sql);
        },
        exec(sql) {
            dbInstance.run(sql);
        },
        transaction(fn) {
            return () => {
                dbInstance.run("BEGIN");
                inTransaction = true;
                try {
                    fn();
                    dbInstance.run("COMMIT");
                    save();
                }
                catch (e) {
                    try {
                        dbInstance.run("ROLLBACK");
                    }
                    catch {
                        // Transaction may already be rolled back by sql.js on error
                    }
                    throw e;
                }
                finally {
                    inTransaction = false;
                }
            };
        },
    };
}
let wrapper = null;
function runSchema(database) {
    const schemaPath = path.join(__dirname, "schema.sql");
    const sql = readFileSync(schemaPath, "utf8");
    database.exec(sql);
}
export async function initDb() {
    if (db)
        return;
    const SQL = await initSqlJs();
    dbPath = path.isAbsolute(config.dbPath)
        ? config.dbPath
        : path.join(process.cwd(), config.dbPath);
    const buffer = existsSync(dbPath)
        ? readFileSync(dbPath)
        : undefined;
    db = new SQL.Database(buffer);
    runSchema(db);
    try {
        db.run("ALTER TABLE rooms ADD COLUMN turn_started_at TEXT");
    }
    catch {
        // Column already exists (e.g. new schema)
    }
    if (!buffer)
        save();
    wrapper = wrap(db);
}
export function getDb() {
    if (!wrapper)
        throw new Error("Database not initialized. Call initDb() first.");
    return wrapper;
}
export function closeDb() {
    if (db) {
        save();
        db.close();
        db = null;
        wrapper = null;
    }
}
