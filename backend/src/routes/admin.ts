import { Router } from "express";
import { getDb } from "../db/index.js";
import {
  fetchAndPrepareEventPool,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
} from "../services/eventIngestion.js";
import { config } from "../config.js";

export const adminRouter = Router();

/** POST /api/admin/refresh-events — fetch from Wikidata and merge with existing pool (cumulative; max 200 per category). Optional: x-refresh-secret header. */
adminRouter.post("/refresh-events", async (req, res) => {
  const secret = (config as { refreshSecret?: string }).refreshSecret;
  if (secret && req.headers["x-refresh-secret"] !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const candidates = await fetchAndPrepareEventPool();
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
    const runTx = db.transaction(() => {
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
    runTx();
    res.json({ ok: true, count: merged.length, added: Math.max(0, merged.length - existing.length) });
  } catch (err) {
    console.error("[POST /api/admin/refresh-events]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to refresh events",
    });
  }
});
