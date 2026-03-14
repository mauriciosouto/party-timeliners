/**
 * Seed the events table: from JSON (if SEED_PATH or data/eventPool.json exists)
 * or by fetching from Wikidata when no file is available.
 * Run: npm run seed
 * To refresh from Wikidata without a file: npm run refresh-events
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "./index.js";
import { fetchAndPrepareEventPool } from "../services/eventIngestion.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
const frontendData = path.join(__dirname, "../../../frontend/data/eventPool.json");
const seedPath = process.env.SEED_PATH ||
    (existsSync(backendData) ? backendData : frontendData);
await initDb();
const db = getDb();
const insertSql = `
  INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;
if (existsSync(seedPath)) {
    const raw = readFileSync(seedPath, "utf8");
    const pool = JSON.parse(raw);
    const runTx = db.transaction(() => {
        const insert = db.prepare(insertSql);
        for (const e of pool) {
            insert.run(e.id, e.title, e.type, e.displayTitle, e.year, e.image ?? null, e.wikipediaUrl ?? null);
        }
    });
    runTx();
    console.log(`Seeded ${pool.length} events from ${seedPath}`);
}
else {
    console.log("No seed file found. Fetching events from Wikidata...");
    const events = await fetchAndPrepareEventPool();
    const runTx = db.transaction(() => {
        db.exec("DELETE FROM events");
        const insert = db.prepare(insertSql);
        for (const e of events) {
            insert.run(e.id, e.title, e.type, e.displayTitle, e.year, e.image, e.wikipediaUrl);
        }
        db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)").run("last_refreshed_at", new Date().toISOString());
    });
    runTx();
    console.log(`Seeded ${events.length} events from Wikidata.`);
}
