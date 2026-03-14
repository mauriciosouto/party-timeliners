/**
 * Ensures the event pool is populated and not expired on server startup.
 * If the table is empty or the pool TTL has elapsed, replaces events from JSON or Wikidata.
 * When fetching from Wikidata, merges with existing pool (cumulative); max 200 per category.
 * Call after initDb().
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index.js";
import {
  fetchAndPrepareEventPool,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
  type PoolEventLike,
} from "../services/eventIngestion.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
/** Seed only from backend data or SEED_PATH; do not use frontend pool so Wikidata is used when no seed file. */
const seedPath = process.env.SEED_PATH || (existsSync(backendData) ? backendData : null);

const META_KEY_LAST_REFRESHED = "last_refreshed_at";

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

function loadExistingPool(db: ReturnType<typeof getDb>): PoolEventLike[] {
  const rows = db.prepare("SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score FROM events").all() as {
    id: string;
    title: string;
    type: string;
    display_title: string;
    year: number;
    image: string | null;
    wikipedia_url: string | null;
    popularity_score: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    displayTitle: r.display_title,
    year: r.year,
    image: r.image ?? undefined,
    wikipediaUrl: r.wikipedia_url ?? undefined,
    popularityScore: r.popularity_score ?? undefined,
  }));
}

function isPoolExpired(db: ReturnType<typeof getDb>): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
  if (row.count === 0) return true;

  const meta = db.prepare("SELECT value FROM event_pool_meta WHERE key = ?").get(META_KEY_LAST_REFRESHED) as { value: string } | undefined;
  if (!meta?.value) return true;

  const ttlMs = config.eventPoolTtlMinutes * 60 * 1000;
  const refreshedAt = new Date(meta.value).getTime();
  const expired = Date.now() - refreshedAt >= ttlMs;
  return expired;
}

function setLastRefreshed(db: ReturnType<typeof getDb>): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)");
  stmt.run(META_KEY_LAST_REFRESHED, new Date().toISOString());
}

export async function ensureEventPool(): Promise<void> {
  const db = getDb();
  if (!isPoolExpired(db)) {
    const row = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
    console.log(`[events] Pool has ${row.count} events and is still valid (TTL ${config.eventPoolTtlMinutes} min).`);
    return;
  }

  console.log(`[events] Pool empty or expired (TTL ${config.eventPoolTtlMinutes} min). Refreshing...`);

  const insertSql = `
    INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  function runRefresh(events: PoolEvent[]): void {
    const runTx = db.transaction(() => {
      db.exec("DELETE FROM events");
      const insert = db.prepare(insertSql);
      for (const e of events) {
        insert.run(
          e.id,
          e.title,
          e.type,
          e.displayTitle,
          e.year,
          e.image ?? null,
          e.wikipediaUrl ?? null,
          e.popularityScore ?? null,
        );
      }
      setLastRefreshed(db);
    });
    runTx();
  }

  if (seedPath && existsSync(seedPath)) {
    const raw = readFileSync(seedPath, "utf8");
    const pool: PoolEvent[] = JSON.parse(raw);
    runRefresh(pool);
    console.log(`[events] Seeded ${pool.length} events from ${seedPath}`);
    return;
  }

  console.log("[events] No seed file. Fetching from Wikidata (merge with existing, max " + LIMIT_PER_CATEGORY + " per category)...");
  const existing = loadExistingPool(db);
  const candidates = await fetchAndPrepareEventPool();
  const merged = mergeWithExistingPool(existing, candidates, LIMIT_PER_CATEGORY);
  runRefresh(
    merged.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      displayTitle: e.displayTitle,
      year: e.year,
      image: e.image,
      wikipediaUrl: e.wikipediaUrl,
      popularityScore: e.popularityScore,
    })),
  );
  console.log(`[events] Pool: ${existing.length} existing + ${candidates.length} candidates → ${merged.length} events.`);
}
