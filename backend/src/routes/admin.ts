import { Router } from "express";
import { queryOne, rowCount } from "../db/index.js";
import { loadExistingPool, commitMergedPool } from "../db/ensureEventPool.js";
import { fetchCategoriesIncremental, mergeWithExistingPool } from "../services/eventIngestion.js";
import { config } from "../config.js";

export const adminRouter = Router();

/** POST /api/admin/refresh-events — fetch all categories, merge, upsert once, then TTL prune. Optional: x-refresh-secret header. */
adminRouter.post("/refresh-events", async (req, res) => {
  const secret = (config as { refreshSecret?: string }).refreshSecret;
  if (secret && req.headers["x-refresh-secret"] !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const initialCount = rowCount(
      await queryOne<{ c: unknown }>("SELECT COUNT(*)::int AS c FROM events", []),
      "c",
    );
    let existing = await loadExistingPool();

    for await (const { events } of fetchCategoriesIncremental()) {
      if (events.length === 0) continue;
      existing = mergeWithExistingPool(existing, events, config.eventStoreLimitPerCategory);
    }

    const { finalCount } = await commitMergedPool(existing);

    res.json({ ok: true, count: finalCount, added: Math.max(0, finalCount - initialCount) });
  } catch (err) {
    console.error("[POST /api/admin/refresh-events]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to refresh events",
    });
  }
});
