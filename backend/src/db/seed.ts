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
import {
  fetchAndPrepareEventPool,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
} from "../services/eventIngestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
/** Only backend data or SEED_PATH; no frontend fallback so Wikidata is used when no seed file. */
const seedPath = process.env.SEED_PATH || (existsSync(backendData) ? backendData : null);

type PoolEvent = {
  id: string;
  title: string;
  type: string;
  displayTitle: string;
  year: number;
  image?: string;
  wikipediaUrl?: string;
  popularityScore?: number;
};

await initDb();
const db = getDb();

const now = new Date().toISOString();
const insertSql = `
  INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

if (seedPath && existsSync(seedPath)) {
  const raw = readFileSync(seedPath, "utf8");
  const pool: PoolEvent[] = JSON.parse(raw);
  const runTx = db.transaction(() => {
    const insert = db.prepare(insertSql);
    for (const e of pool) {
      insert.run(
        e.id,
        e.title,
        e.type,
        e.displayTitle,
        e.year,
        e.image ?? null,
        e.wikipediaUrl ?? null,
        e.popularityScore ?? null,
        now,
      );
    }
  });
  runTx();
  console.log(`Seeded ${pool.length} events from ${seedPath}`);
} else {
  console.log("No seed file found. Fetching from Wikidata (merge with existing, max " + LIMIT_PER_CATEGORY + " per category)...");
  const existing = db
    .prepare("SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at FROM events")
    .all() as { id: string; title: string; type: string; display_title: string; year: number; image: string | null; wikipedia_url: string | null; popularity_score: number | null; refreshed_at: string | null }[];
  const existingPool = existing.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    displayTitle: r.display_title,
    year: r.year,
    image: r.image ?? undefined,
    wikipediaUrl: r.wikipedia_url ?? undefined,
    popularityScore: r.popularity_score ?? undefined,
    refreshed_at: r.refreshed_at ?? undefined,
  }));
  const candidates = await fetchAndPrepareEventPool();
  const merged = mergeWithExistingPool(existingPool, candidates, LIMIT_PER_CATEGORY);
  const runTx = db.transaction(() => {
    db.exec("DELETE FROM events");
    const insert = db.prepare(insertSql);
    for (const e of merged) {
      insert.run(
        e.id,
        e.title,
        e.type,
        e.displayTitle,
        e.year,
        e.image,
        e.wikipediaUrl,
        e.popularityScore ?? null,
        e.refreshed_at ?? now,
      );
    }
    db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)").run("last_refreshed_at", new Date().toISOString());
  });
  runTx();
  console.log(`Pool: ${existingPool.length} existing + ${candidates.length} candidates → ${merged.length} events.`);
}
