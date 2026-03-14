/**
 * Fetch events from Wikidata and merge with existing pool (cumulative; max 200 per category).
 * Run: npm run refresh-events
 */
import { initDb, getDb } from "../src/db/index.js";
import {
  fetchAndPrepareEventPool,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
} from "../src/services/eventIngestion.js";

async function main() {
  console.log("Fetching events from Wikidata (merge with existing, max " + LIMIT_PER_CATEGORY + " per category)...");
  const candidates = await fetchAndPrepareEventPool();
  console.log(`Prepared ${candidates.length} candidates.`);

  await initDb();
  const db = getDb();

  const existing = db
    .prepare("SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score FROM events")
    .all() as { id: string; title: string; type: string; display_title: string; year: number; image: string | null; wikipedia_url: string | null; popularity_score: number | null }[];
  const existingPool = existing.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    displayTitle: r.display_title,
    year: r.year,
    image: r.image ?? undefined,
    wikipediaUrl: r.wikipedia_url ?? undefined,
    popularityScore: r.popularity_score ?? undefined,
  }));
  const merged = mergeWithExistingPool(existingPool, candidates, LIMIT_PER_CATEGORY);

  const deleteStmt = db.prepare("DELETE FROM events");
  const insertStmt = db.prepare(`
    INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runTransaction = db.transaction(() => {
    deleteStmt.run();
    for (const e of merged) {
      insertStmt.run(
        e.id,
        e.title,
        e.type,
        e.displayTitle,
        e.year,
        e.image,
        e.wikipediaUrl,
        e.popularityScore ?? null,
      );
    }
    db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)").run("last_refreshed_at", new Date().toISOString());
  });

  runTransaction();
  console.log(`Pool: ${existingPool.length} existing + ${candidates.length} candidates → ${merged.length} events (TTL reset).`);
}

main().catch((err) => {
  console.error("Refresh events failed:", err);
  process.exitCode = 1;
});
