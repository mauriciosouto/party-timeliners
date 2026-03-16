/**
 * Ensures the event pool is populated on server startup.
 * - If the pool is valid (not expired): does nothing; server starts immediately.
 * - If the pool is empty and a seed file exists: loads from seed synchronously (fast), then
 *   starts a background refresh from Wikidata so the list can be updated without blocking.
 * - If the pool is empty and no seed file, or the pool is expired: server starts immediately
 *   with existing events (if any), and a background job fetches from Wikidata and updates
 *   the pool. You can play with existing events while the update runs.
 * Call after initDb().
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index.js";
import {
  fetchCategoriesIncremental,
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
  TARGET_POOL_SIZE,
  type PoolEventLike,
} from "../services/eventIngestion.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
/** Seed only from backend data or SEED_PATH; do not use frontend pool so Wikidata is used when no seed file. */
const seedPath = process.env.SEED_PATH || (existsSync(backendData) ? backendData : null);

const META_KEY_LAST_REFRESHED = "last_refreshed_at";

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
  const rows = db.prepare(
    "SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at FROM events",
  ).all() as {
    id: string;
    title: string;
    type: string;
    display_title: string;
    year: number;
    image: string | null;
    wikipedia_url: string | null;
    popularity_score: number | null;
    refreshed_at: string | null;
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
  }));
}

function getEventCount(db: ReturnType<typeof getDb>): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
  return row.count;
}

/** Cutoff ISO string: events with refreshed_at before this are considered expired (per-event TTL). */
function getTtlCutoff(): string {
  const cutoff = new Date(Date.now() - config.eventPoolTtlMinutes * 60 * 1000).toISOString();
  return cutoff;
}

/** Delete events whose refreshed_at is older than TTL or null (legacy rows). Returns number deleted. */
export function deleteExpiredEvents(db: ReturnType<typeof getDb>): number {
  const cutoff = getTtlCutoff();
  const row = db.prepare("SELECT COUNT(*) as n FROM events WHERE refreshed_at IS NULL OR refreshed_at < ?").get(cutoff) as { n: number } | undefined;
  const count = row?.n ?? 0;
  if (count > 0) {
    db.prepare("DELETE FROM events WHERE refreshed_at IS NULL OR refreshed_at < ?").run(cutoff);
  }
  return count;
}

/** True if pool is empty or has at least one expired event (refreshed_at older than TTL or null). */
function isPoolExpired(db: ReturnType<typeof getDb>): boolean {
  if (getEventCount(db) === 0) return true;
  const cutoff = getTtlCutoff();
  const row = db.prepare("SELECT 1 FROM events WHERE refreshed_at IS NULL OR refreshed_at < ? LIMIT 1").get(cutoff) as { "1"?: number } | undefined;
  return row != null;
}

function setLastRefreshed(db: ReturnType<typeof getDb>): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO event_pool_meta (key, value) VALUES (?, ?)");
  stmt.run(META_KEY_LAST_REFRESHED, new Date().toISOString());
}

const INSERT_SQL = `
  INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Minimum events required to start a game (1 initial + 3*players + draw pool). Wait for this when pool is empty on startup. */
const MIN_EVENTS_TO_START = 160;

export function writePoolToDb(db: ReturnType<typeof getDb>, events: PoolEventLike[]): void {
  const now = new Date().toISOString();
  const runTx = db.transaction(() => {
    db.exec("DELETE FROM events");
    const insert = db.prepare(INSERT_SQL);
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
      );
    }
    setLastRefreshed(db);
  });
  runTx();
}

/**
 * Fetches from Wikidata category by category; after each category merges into the
 * pool and writes to DB so the pool is usable as soon as the first categories are in.
 * Removes events older than per-event TTL before merging so only the oldest events are dropped.
 */
function runRefreshEventPool(): Promise<void> {
  console.log("[events] Refresh started (incremental: prune expired, then merge + write after each category).");
  return (async () => {
    const db = getDb();
    const deleted = deleteExpiredEvents(db);
    if (deleted > 0) console.log(`[events] Pruned ${deleted} expired events (older than ${config.eventPoolTtlMinutes} min).`);
    let existing = loadExistingPool(db);

    for await (const { categoryKey: _key, events } of fetchCategoriesIncremental()) {
      if (events.length === 0) continue;
      const merged = mergeWithExistingPool(existing, events, LIMIT_PER_CATEGORY);
      merged.sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
      const capped = merged.slice(0, TARGET_POOL_SIZE);
      writePoolToDb(db, capped);
      existing = capped;
    }

    const finalCount = getEventCount(db);
    console.log(`[events] Refresh done: pool has ${finalCount} events.`);
  })();
}

/** Fire-and-forget wrapper; errors are logged only. */
function refreshEventPoolInBackground(): void {
  runRefreshEventPool().catch((err) => console.error("[events] Background refresh failed:", err));
}

export async function ensureEventPool(): Promise<void> {
  const db = getDb();
  const count = getEventCount(db);
  const expired = isPoolExpired(db);

  if (!expired) {
    console.log(`[events] Pool has ${count} events and is still valid (per-event TTL ${config.eventPoolTtlMinutes} min).`);
    return;
  }

  // Pool empty or expired: start server immediately and refresh in background (or load seed first if empty + seed exists).
  if (count === 0 && seedPath && existsSync(seedPath)) {
    const raw = readFileSync(seedPath, "utf8");
    const pool: PoolEvent[] = JSON.parse(raw);
    const now = new Date().toISOString();
    const runTx = db.transaction(() => {
      db.exec("DELETE FROM events");
      const insert = db.prepare(INSERT_SQL);
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
      console.log(`[events] Pool has ${after} events (need ${MIN_EVENTS_TO_START}+ for full games). Server starting; refresh may still be running.`);
    }
  } else {
    console.log(`[events] Pool expired (${count} events). Server starting with existing events; refreshing from Wikidata in background.`);
    refreshEventPoolInBackground();
  }
}
