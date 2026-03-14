import { Router } from "express";
import { getDb } from "../db/index.js";
import { fetchAndPrepareEventPool } from "../services/eventIngestion.js";
import { config } from "../config.js";

export const adminRouter = Router();

/** POST /api/admin/refresh-events — fetch from Wikidata and replace events table. Optional: x-refresh-secret header. */
adminRouter.post("/refresh-events", async (req, res) => {
  const secret = (config as { refreshSecret?: string }).refreshSecret;
  if (secret && req.headers["x-refresh-secret"] !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const events = await fetchAndPrepareEventPool();
    const db = getDb();
    const deleteStmt = db.prepare("DELETE FROM events");
    const insertStmt = db.prepare(`
      INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const runTx = db.transaction(() => {
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
    runTx();
    res.json({ ok: true, count: events.length });
  } catch (err) {
    console.error("[POST /api/admin/refresh-events]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to refresh events",
    });
  }
});
