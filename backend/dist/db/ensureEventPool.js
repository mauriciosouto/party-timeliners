/**
 * Ensures the event pool is populated and not expired on server startup.
 * If the table is empty or the pool TTL has elapsed, replaces events from JSON or Wikidata.
 * Call after initDb().
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index.js";
import { fetchAndPrepareEventPool } from "../services/eventIngestion.js";
import { config } from "../config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
const frontendData = path.join(__dirname, "../../../frontend/data/eventPool.json");
const seedPath = process.env.SEED_PATH ||
    (existsSync(backendData) ? backendData : frontendData);
const META_KEY_LAST_REFRESHED = "last_refreshed_at";
function isPoolExpired(db) {
    const row = db.prepare("SELECT COUNT(*) as count FROM events").get();
    if (row.count === 0)
        return true;
    const meta = db.prepare("SELECT value FROM event_pool_meta WHERE key = ?").get(META_KEY_LAST_REFRESHED);
    if (!meta?.value)
        return true;
    const ttlMs = config.eventPoolTtlMinutes * 60 * 1000;
    const refreshedAt = new Date(meta.value).getTime();
    const expired = Date.now() - refreshedAt >= ttlMs;
    return expired;
}
function setLastRefreshed(db) {
    const stmt = db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)");
    stmt.run(META_KEY_LAST_REFRESHED, new Date().toISOString());
}
export async function ensureEventPool() {
    const db = getDb();
    if (!isPoolExpired(db)) {
        const row = db.prepare("SELECT COUNT(*) as count FROM events").get();
        console.log(`[events] Pool has ${row.count} events and is still valid (TTL ${config.eventPoolTtlMinutes} min).`);
        return;
    }
    console.log(`[events] Pool empty or expired (TTL ${config.eventPoolTtlMinutes} min). Refreshing...`);
    const insertSql = `
    INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
    function runRefresh(events) {
        const runTx = db.transaction(() => {
            db.exec("DELETE FROM events");
            const insert = db.prepare(insertSql);
            for (const e of events) {
                insert.run(e.id, e.title, e.type, e.displayTitle, e.year, e.image ?? null, e.wikipediaUrl ?? null);
            }
            setLastRefreshed(db);
        });
        runTx();
    }
    if (existsSync(seedPath)) {
        const raw = readFileSync(seedPath, "utf8");
        const pool = JSON.parse(raw);
        runRefresh(pool);
        console.log(`[events] Seeded ${pool.length} events from ${seedPath}`);
        return;
    }
    console.log("[events] No seed file. Fetching from Wikidata...");
    const events = await fetchAndPrepareEventPool();
    runRefresh(events.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        displayTitle: e.displayTitle,
        year: e.year,
        image: e.image,
        wikipediaUrl: e.wikipediaUrl,
    })));
    console.log(`[events] Seeded ${events.length} events from Wikidata.`);
}
