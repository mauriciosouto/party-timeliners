import { Router } from "express";
import { getDb } from "../db/index.js";
import { loadExistingPool, writePoolToDb } from "../db/ensureEventPool.js";
import {
  fetchCategoriesIncremental,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
  TARGET_POOL_SIZE,
} from "../services/eventIngestion.js";
import { config } from "../config.js";

export const adminRouter = Router();

/** POST /api/admin/refresh-events — fetch from Wikidata category by category; merge and write after each category. Optional: x-refresh-secret header. */
adminRouter.post("/refresh-events", async (req, res) => {
  const secret = (config as { refreshSecret?: string }).refreshSecret;
  if (secret && req.headers["x-refresh-secret"] !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const db = getDb();
    let existing = loadExistingPool(db);
    const initialCount = existing.length;

    for await (const { events } of fetchCategoriesIncremental()) {
      if (events.length === 0) continue;
      const merged = mergeWithExistingPool(existing, events, LIMIT_PER_CATEGORY);
      merged.sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
      const capped = merged.slice(0, TARGET_POOL_SIZE);
      writePoolToDb(db, capped);
      existing = capped;
    }

    res.json({ ok: true, count: existing.length, added: Math.max(0, existing.length - initialCount) });
  } catch (err) {
    console.error("[POST /api/admin/refresh-events]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to refresh events",
    });
  }
});
