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
import { fetchAndPrepareEventPool, mergeWithExistingPool } from "../services/eventIngestion.js";
import { commitMergedPool } from "./ensureEventPool.js";
import { config } from "../config.js";

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
        now,
      );
    }
  });
  runTx();
  console.log(`Seeded ${pool.length} events from ${seedPath}`);
} else {
  console.log(
    "No seed file found. Fetching from Wikidata (merge with existing, max " +
      config.eventStoreLimitPerCategory +
      " per category, then upsert + TTL)...",
  );
  const existing = db
    .prepare(
      "SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at FROM events",
    )
    .all() as {
      id: string;
      title: string;
      type: string;
      display_title: string;
      year: number;
      image: string | null;
      wikipedia_url: string | null;
      popularity_score: number | null;
      refreshed_at: string | null;
      created_at: string | null;
    }[];
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
    created_at: r.created_at ?? undefined,
  }));
  const candidates = await fetchAndPrepareEventPool();
  const merged = mergeWithExistingPool(existingPool, candidates, config.eventStoreLimitPerCategory);
  const { finalCount, orphansRemoved, expiredRemoved } = commitMergedPool(db, merged);
  console.log(
    `Pool: ${existingPool.length} existing + ${candidates.length} candidates → ${finalCount} rows (orphans: ${orphansRemoved}, TTL: ${expiredRemoved}).`,
  );
}
