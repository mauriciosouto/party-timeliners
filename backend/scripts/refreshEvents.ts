/**
 * Fetch events from Wikidata and replace the events table in the database.
 * Run: npm run refresh-events
 */
import { initDb, getDb } from "../src/db/index.js";
import { fetchAndPrepareEventPool } from "../src/services/eventIngestion.js";

async function main() {
  console.log("Fetching events from Wikidata...");
  const events = await fetchAndPrepareEventPool();
  console.log(`Prepared ${events.length} events.`);

  await initDb();
  const db = getDb();

  const deleteStmt = db.prepare("DELETE FROM events");
  const insertStmt = db.prepare(`
    INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const runTransaction = db.transaction(() => {
    deleteStmt.run();
    for (const e of events) {
      insertStmt.run(
        e.id,
        e.title,
        e.type,
        e.displayTitle,
        e.year,
        e.image,
        e.wikipediaUrl,
      );
    }
    db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)").run("last_refreshed_at", new Date().toISOString());
  });

  runTransaction();
  console.log(`Replaced events table with ${events.length} events (TTL reset).`);
}

main().catch((err) => {
  console.error("Refresh events failed:", err);
  process.exitCode = 1;
});
