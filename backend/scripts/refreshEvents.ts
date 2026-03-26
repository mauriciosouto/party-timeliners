/**
 * Fetch events from Wikidata for all categories, merge in memory, upsert once, TTL prune.
 * Run: npm run refresh-events
 */
import { initDb } from "../src/db/index.js";
import { loadExistingPool, commitMergedPool } from "../src/db/ensureEventPool.js";
import { fetchCategoriesIncremental, mergeWithExistingPool } from "../src/services/eventIngestion.js";
import { config } from "../src/config.js";

async function main() {
  console.log(
    `Fetching from Wikidata (store ≤${config.eventStoreLimitPerCategory} events/category, then upsert + TTL)...`,
  );

  await initDb();
  let existing = await loadExistingPool();
  const initialCount = existing.length;

  for await (const { categoryKey: _key, events } of fetchCategoriesIncremental()) {
    if (events.length === 0) continue;
    existing = mergeWithExistingPool(existing, events, config.eventStoreLimitPerCategory);
  }

  const { finalCount, orphansRemoved, expiredRemoved } = await commitMergedPool(existing);
  console.log(
    `Pool: ${initialCount} → ${finalCount} rows (orphans removed: ${orphansRemoved}, TTL pruned: ${expiredRemoved}).`,
  );
}

main().catch((err) => {
  console.error("Refresh events failed:", err);
  process.exitCode = 1;
});
