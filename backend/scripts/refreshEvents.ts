/**
 * Fetch events from Wikidata category by category; merge and write to DB after each category.
 * Run: npm run refresh-events
 */
import { initDb, getDb } from "../src/db/index.js";
import { loadExistingPool, writePoolToDb } from "../src/db/ensureEventPool.js";
import {
  fetchCategoriesIncremental,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
  TARGET_POOL_SIZE,
} from "../src/services/eventIngestion.js";

async function main() {
  console.log("Fetching events from Wikidata (incremental: merge + write after each category)...");

  await initDb();
  const db = getDb();
  let existing = loadExistingPool(db);
  const initialCount = existing.length;

  for await (const { categoryKey: _key, events } of fetchCategoriesIncremental()) {
    if (events.length === 0) continue;
    const merged = mergeWithExistingPool(existing, events, LIMIT_PER_CATEGORY);
    merged.sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
    const capped = merged.slice(0, TARGET_POOL_SIZE);
    writePoolToDb(db, capped);
    existing = capped;
  }

  const finalCount = existing.length;
  console.log(`Pool: ${initialCount} → ${finalCount} events (TTL reset).`);
}

main().catch((err) => {
  console.error("Refresh events failed:", err);
  process.exitCode = 1;
});
