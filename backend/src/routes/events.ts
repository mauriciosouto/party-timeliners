import { Router } from "express";
import { getDb } from "../db/index.js";

export const eventsRouter = Router();

/** GET /api/events/next — return one random event from the DB (e.g. for single-player). */
eventsRouter.get("/next", (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT id, title, type, display_title, year, image, wikipedia_url FROM events ORDER BY RANDOM() LIMIT 1",
      )
      .get() as
      | {
          id: string;
          title: string;
          type: string;
          display_title: string;
          year: number;
          image: string | null;
          wikipedia_url: string | null;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: "No events in pool. Run npm run refresh-events or seed." });
      return;
    }

    res.json({
      event: {
        id: row.id,
        title: row.title,
        type: row.type,
        displayTitle: row.display_title,
        year: row.year,
        image: row.image ?? undefined,
        wikipediaUrl: row.wikipedia_url ?? undefined,
      },
    });
  } catch (err) {
    console.error("[GET /api/events/next]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to get next event",
    });
  }
});
