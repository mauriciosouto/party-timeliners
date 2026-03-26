/**
 * Seed the events table: from JSON (if SEED_PATH or data/eventPool.json exists)
 * or by fetching from Wikidata when no file is available.
 * Run: npm run seed
 * To refresh from Wikidata without a file: npm run refresh-events
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, closeDb } from "./index.js";
import { fetchAndPrepareEventPool, mergeWithExistingPool } from "../services/eventIngestion.js";
import { commitMergedPool, loadExistingPool, writePoolToDb } from "./ensureEventPool.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
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

async function main(): Promise<void> {
  await initDb();

  if (seedPath && existsSync(seedPath)) {
    const raw = readFileSync(seedPath, "utf8");
    const pool: PoolEvent[] = JSON.parse(raw);
    const now = new Date().toISOString();
    await writePoolToDb(
      pool.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        displayTitle: e.displayTitle,
        year: e.year,
        image: e.image,
        wikipediaUrl: e.wikipediaUrl,
        popularityScore: e.popularityScore,
        refreshed_at: now,
        created_at: now,
      })),
    );
    console.log(`Seeded ${pool.length} events from ${seedPath}`);
  } else {
    console.log(
      "No seed file found. Fetching from Wikidata (merge with existing, max " +
        config.eventStoreLimitPerCategory +
        " per category, then upsert + TTL)...",
    );
    const existingPool = await loadExistingPool();
    const candidates = await fetchAndPrepareEventPool();
    const merged = mergeWithExistingPool(existingPool, candidates, config.eventStoreLimitPerCategory);
    const { finalCount, orphansRemoved, expiredRemoved } = await commitMergedPool(merged);
    console.log(
      `Pool: ${existingPool.length} existing + ${candidates.length} candidates → ${finalCount} rows (orphans: ${orphansRemoved}, TTL: ${expiredRemoved}).`,
    );
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
