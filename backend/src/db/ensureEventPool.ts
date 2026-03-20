/**
 * Ensures the event pool is populated on server startup.
 * - Refresh: merge all categories in memory, then upsert (no full-table wipe), remove orphans,
 *   then TTL prune (by created_at, with a playable floor and FK safety).
 * - If the pool is empty and a seed file exists: loads from seed synchronously, then background Wikidata refresh.
 * - If the pool is empty and no seed: waits for initial refresh (up to 90s).
 * Call after initDb().
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index.js";
import {
  fetchCategoriesIncremental,
  mergeWithExistingPool,
  type PoolEventLike,
} from "../services/eventIngestion.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
const seedPath = process.env.SEED_PATH || (existsSync(backendData) ? backendData : null);

const META_KEY_LAST_REFRESHED = "last_refreshed_at";

/** Minimum events required to start a game. TTL pruning never goes below this if avoidable. */
const MIN_EVENTS_TO_START = 160;

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

export function loadExistingPool(db: ReturnType<typeof getDb>): PoolEventLike[] {
  const rows = db
    .prepare(
      "SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at FROM events",
    )
    .all() as {
      id: string;
      title: string;
      type: string;
      display_title: string;
      year: number;
      image: string | null;
      wikipedia_url: string | null;
      popularity_score: number | null;
      refreshed_at: string | null;
      created_at: string | null;
    }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    displayTitle: r.display_title,
    year: r.year,
    image: r.image ?? undefined,
    wikipediaUrl: r.wikipedia_url ?? undefined,
    popularityScore: r.popularity_score ?? undefined,
    refreshed_at: r.refreshed_at ?? undefined,
    created_at: r.created_at ?? undefined,
  }));
}

function getEventCount(db: ReturnType<typeof getDb>): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
  return row.count;
}

/** Cutoff ISO: rows with first-seen time before this are TTL-expired. */
function getTtlCutoff(): string {
  return new Date(Date.now() - config.eventPoolTtlMinutes * 60 * 1000).toISOString();
}

function isEventReferencedByRoom(db: ReturnType<typeof getDb>, eventId: string): boolean {
  if (db.prepare("SELECT 1 FROM room_timeline WHERE event_id = ? LIMIT 1").get(eventId)) return true;
  if (db.prepare("SELECT 1 FROM room_deck WHERE event_id = ? LIMIT 1").get(eventId)) return true;
  if (db.prepare("SELECT 1 FROM room_hand WHERE event_id = ? LIMIT 1").get(eventId)) return true;
  if (db.prepare("SELECT 1 FROM rooms WHERE initial_event_id = ? LIMIT 1").get(eventId)) return true;
  return false;
}

/**
 * Deletes TTL-expired events (by created_at, fallback refreshed_at), oldest first,
 * without dropping below MIN_EVENTS_TO_START and without deleting rows still referenced by rooms.
 */
export function deleteExpiredEvents(db: ReturnType<typeof getDb>): number {
  const cutoff = getTtlCutoff();
  const total = getEventCount(db);
  const maxDeletable = Math.max(0, total - MIN_EVENTS_TO_START);

  const rows = db
    .prepare(
      `SELECT id FROM events
       WHERE datetime(COALESCE(created_at, refreshed_at, '1970-01-01T00:00:00.000Z')) < datetime(?)
       ORDER BY datetime(COALESCE(created_at, refreshed_at, '1970-01-01T00:00:00.000Z')) ASC`,
    )
    .all(cutoff) as { id: string }[];

  let deleted = 0;
  for (const { id } of rows) {
    if (deleted >= maxDeletable) break;
    if (isEventReferencedByRoom(db, id)) continue;
    db.prepare("DELETE FROM events WHERE id = ?").run(id);
    deleted++;
  }
  return deleted;
}

function setLastRefreshed(db: ReturnType<typeof getDb>): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)");
  stmt.run(META_KEY_LAST_REFRESHED, new Date().toISOString());
}

const UPSERT_SQL = `
  INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    type = excluded.type,
    display_title = excluded.display_title,
    year = excluded.year,
    image = excluded.image,
    wikipedia_url = excluded.wikipedia_url,
    popularity_score = excluded.popularity_score,
    refreshed_at = excluded.refreshed_at,
    created_at = events.created_at
`;

/** Upsert every row; refreshed_at = now; created_at preserved on conflict, set on new rows. */
export function upsertMergedPool(db: ReturnType<typeof getDb>, events: PoolEventLike[]): void {
  const now = new Date().toISOString();
  const runTx = db.transaction(() => {
    const stmt = db.prepare(UPSERT_SQL);
    for (const e of events) {
      stmt.run(
        e.id,
        e.title ?? "",
        e.type,
        e.displayTitle ?? `${e.title ?? ""} (${e.type})`,
        e.year ?? 0,
        e.image ?? null,
        e.wikipediaUrl ?? null,
        e.popularityScore ?? null,
        now,
        e.created_at ?? now,
      );
    }
    setLastRefreshed(db);
  });
  runTx();
}

/**
 * Remove DB rows not in keepIds, only if not referenced by any room (FK-safe).
 */
export function removePoolEventsNotInMerged(db: ReturnType<typeof getDb>, keepIds: Set<string>): number {
  let removed = 0;
  const runTx = db.transaction(() => {
    db.exec("CREATE TEMP TABLE IF NOT EXISTS _pool_keep (id TEXT PRIMARY KEY)");
    db.exec("DELETE FROM _pool_keep");
    const ins = db.prepare("INSERT OR IGNORE INTO _pool_keep (id) VALUES (?)");
    for (const id of keepIds) {
      ins.run(id);
    }
    const before = (db.prepare("SELECT COUNT(*) as c FROM events").get() as { c: number }).c;
    db.exec(`
      DELETE FROM events
      WHERE id NOT IN (SELECT id FROM _pool_keep)
      AND NOT EXISTS (SELECT 1 FROM room_timeline WHERE room_timeline.event_id = events.id)
      AND NOT EXISTS (SELECT 1 FROM room_deck WHERE room_deck.event_id = events.id)
      AND NOT EXISTS (SELECT 1 FROM room_hand WHERE room_hand.event_id = events.id)
      AND NOT EXISTS (SELECT 1 FROM rooms WHERE rooms.initial_event_id = events.id)
    `);
    const after = (db.prepare("SELECT COUNT(*) as c FROM events").get() as { c: number }).c;
    removed = before - after;
  });
  runTx();
  return removed;
}

/** Sort by popularity; optional global cap (config.eventPoolMaxTotal). */
export function applyMaxTotalToMerged(merged: PoolEventLike[]): PoolEventLike[] {
  const sorted = [...merged].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
  const max = config.eventPoolMaxTotal;
  if (max == null || sorted.length <= max) return sorted;
  return sorted.slice(0, max);
}

/**
 * After Wikidata merge: upsert canonical set, drop unreferenced orphans, TTL prune.
 */
export function commitMergedPool(db: ReturnType<typeof getDb>, merged: PoolEventLike[]): {
  finalCount: number;
  orphansRemoved: number;
  expiredRemoved: number;
} {
  const canonical = applyMaxTotalToMerged(merged);
  upsertMergedPool(db, canonical);
  const keep = new Set(canonical.map((e) => e.id));
  const orphansRemoved = removePoolEventsNotInMerged(db, keep);
  const expiredRemoved = deleteExpiredEvents(db);
  return {
    finalCount: getEventCount(db),
    orphansRemoved,
    expiredRemoved,
  };
}

const INSERT_SEED_SQL = `
  INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Replace entire pool (empty DB seed only). */
export function writePoolToDb(db: ReturnType<typeof getDb>, events: PoolEventLike[]): void {
  const now = new Date().toISOString();
  const runTx = db.transaction(() => {
    db.exec("DELETE FROM events");
    const insert = db.prepare(INSERT_SEED_SQL);
    for (const e of events) {
      insert.run(
        e.id,
        e.title ?? "",
        e.type,
        e.displayTitle ?? `${e.title ?? ""} (${e.type})`,
        e.year ?? 0,
        e.image ?? null,
        e.wikipediaUrl ?? null,
        e.popularityScore ?? null,
        e.refreshed_at ?? now,
        e.created_at ?? e.refreshed_at ?? now,
      );
    }
    setLastRefreshed(db);
  });
  runTx();
}

/**
 * Fetch all categories, merge in memory, then commit once (upsert + orphan cleanup + TTL).
 */
export function runRefreshEventPool(): Promise<void> {
  console.log(
    `[events] Refresh started: merge in memory (≤${config.eventStoreLimitPerCategory}/category), then upsert + TTL (~${config.eventPoolTtlMinutes} min).`,
  );
  return (async () => {
    const db = getDb();
    let existing = loadExistingPool(db);

    for await (const { categoryKey: _key, events } of fetchCategoriesIncremental()) {
      if (events.length === 0) continue;
      existing = mergeWithExistingPool(existing, events, config.eventStoreLimitPerCategory);
    }

    const { finalCount, orphansRemoved, expiredRemoved } = commitMergedPool(db, existing);
    if (orphansRemoved > 0) console.log(`[events] Removed ${orphansRemoved} orphan pool rows (replaced / over cap).`);
    if (expiredRemoved > 0) {
      console.log(`[events] Pruned ${expiredRemoved} TTL-expired events (older than ${config.eventPoolTtlMinutes} min, floor ${MIN_EVENTS_TO_START}).`);
    }
    console.log(`[events] Refresh done: pool has ${finalCount} events.`);
  })();
}

function refreshEventPoolInBackground(): void {
  runRefreshEventPool().catch((err) => console.error("[events] Background refresh failed:", err));
}

export async function ensureEventPool(): Promise<void> {
  const db = getDb();
  const count = getEventCount(db);

  if (count === 0 && seedPath && existsSync(seedPath)) {
    const raw = readFileSync(seedPath, "utf8");
    const pool: PoolEvent[] = JSON.parse(raw);
    const now = new Date().toISOString();
    const runTx = db.transaction(() => {
      db.exec("DELETE FROM events");
      const insert = db.prepare(INSERT_SEED_SQL);
      for (const e of pool) {
        insert.run(
          e.id,
          e.title,
          e.type,
          e.displayTitle,
          e.year,
          e.image ?? null,
          e.wikipediaUrl ?? null,
          e.popularityScore ?? null,
          now,
          now,
        );
      }
      setLastRefreshed(db);
    });
    runTx();
    console.log(`[events] Seeded ${pool.length} events from ${seedPath}. Refreshing from Wikidata in background...`);
    refreshEventPoolInBackground();
    return;
  }

  if (count === 0) {
    console.log("[events] Pool empty. Waiting for initial refresh from Wikidata (up to 90s)...");
    const timeoutMs = 90_000;
    try {
      await Promise.race([
        runRefreshEventPool(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
    } catch (err) {
      const msg = err instanceof Error && err.message === "timeout" ? "Timeout waiting for events." : err;
      console.warn("[events]", msg);
    }
    const after = getEventCount(db);
    if (after >= MIN_EVENTS_TO_START) {
      console.log(`[events] Pool ready: ${after} events.`);
    } else {
      console.log(
        `[events] Pool has ${after} events (need ${MIN_EVENTS_TO_START}+ for full games). Server starting; refresh may still be running.`,
      );
    }
    return;
  }

  if (count < MIN_EVENTS_TO_START) {
    console.log(
      `[events] Pool has ${count} events (need ${MIN_EVENTS_TO_START}+ for full games). Refreshing from Wikidata in background to add more.`,
    );
  } else {
    console.log(`[events] Pool has ${count} events. Refreshing from Wikidata in background to top up.`);
  }
  refreshEventPoolInBackground();
}
