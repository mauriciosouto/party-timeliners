/**
 * Ensures the event pool is populated on server startup (PostgreSQL).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import {
  exec,
  execClient,
  queryOne,
  queryOneClient,
  queryRows,
  rowCount,
  withTransaction,
} from "./index.js";
import {
  fetchCategoriesIncremental,
  mergeWithExistingPool,
  type PoolEventLike,
} from "../services/eventIngestion.js";
import { config } from "../config.js";
import { clearEventCache } from "./eventCache.js";
import { collectLiveRoomReferencedEventIds } from "../services/liveRoomStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendData = path.join(__dirname, "../../data/eventPool.json");
const seedPath = process.env.SEED_PATH || (existsSync(backendData) ? backendData : null);

const META_KEY_LAST_REFRESHED = "last_refreshed_at";
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

export async function loadExistingPool(): Promise<PoolEventLike[]> {
  const rows = await queryRows<{
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
  }>(
    "SELECT id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at FROM events",
    [],
  );
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

async function getEventCount(): Promise<number> {
  const row = await queryOne<{ count: unknown }>("SELECT COUNT(*)::int AS count FROM events", []);
  return rowCount(row, "count");
}

function getTtlCutoff(): string {
  return new Date(Date.now() - config.eventPoolTtlMinutes * 60 * 1000).toISOString();
}

async function isEventReferencedByRoomPool(eventId: string): Promise<boolean> {
  if (collectLiveRoomReferencedEventIds().has(eventId)) return true;
  const checks = [
    "SELECT 1 AS x FROM room_timeline WHERE event_id = ? LIMIT 1",
    "SELECT 1 AS x FROM room_deck WHERE event_id = ? LIMIT 1",
    "SELECT 1 AS x FROM room_hand WHERE event_id = ? LIMIT 1",
    "SELECT 1 AS x FROM rooms WHERE initial_event_id = ? LIMIT 1",
  ];
  for (const sql of checks) {
    const row = await queryOne(sql, [eventId]);
    if (row) return true;
  }
  return false;
}

export async function deleteExpiredEvents(): Promise<number> {
  const cutoff = getTtlCutoff();
  const total = await getEventCount();
  const maxDeletable = Math.max(0, total - MIN_EVENTS_TO_START);

  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM events
     WHERE COALESCE(created_at::timestamptz, refreshed_at::timestamptz, '1970-01-01Z'::timestamptz)
           < ?::timestamptz
     ORDER BY COALESCE(created_at::timestamptz, refreshed_at::timestamptz, '1970-01-01Z'::timestamptz) ASC`,
    [cutoff],
  );

  let deleted = 0;
  for (const { id } of rows) {
    if (deleted >= maxDeletable) break;
    if (await isEventReferencedByRoomPool(id)) continue;
    await exec("DELETE FROM events WHERE id = ?", [id]);
    deleted++;
  }
  return deleted;
}

async function setLastRefreshed(client: PoolClient): Promise<void> {
  await execClient(
    client,
    `INSERT INTO event_pool_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [META_KEY_LAST_REFRESHED, new Date().toISOString()],
  );
}

const UPSERT_SQL = `
  INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    type = EXCLUDED.type,
    display_title = EXCLUDED.display_title,
    year = EXCLUDED.year,
    image = EXCLUDED.image,
    wikipedia_url = EXCLUDED.wikipedia_url,
    popularity_score = EXCLUDED.popularity_score,
    refreshed_at = EXCLUDED.refreshed_at,
    created_at = events.created_at
`;

export async function upsertMergedPool(events: PoolEventLike[]): Promise<void> {
  const now = new Date().toISOString();
  await withTransaction(async (client) => {
    for (const e of events) {
      await execClient(client, UPSERT_SQL, [
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
      ]);
    }
    await setLastRefreshed(client);
  });
}

export async function removePoolEventsNotInMerged(keepIds: Set<string>): Promise<number> {
  return withTransaction(async (client) => {
    await execClient(
      client,
      "CREATE TEMP TABLE _pool_keep (id TEXT PRIMARY KEY) ON COMMIT DROP",
      [],
    );
    const ins = "INSERT INTO _pool_keep (id) VALUES (?)";
    for (const id of keepIds) {
      await execClient(client, ins, [id]);
    }
    const beforeRow = await queryOneClient<{ c: unknown }>(
      client,
      "SELECT COUNT(*)::int AS c FROM events",
      [],
    );
    const before = rowCount(beforeRow, "c");
    const liveHeld = [...collectLiveRoomReferencedEventIds()];
    const liveClause =
      liveHeld.length === 0 ? "" : " AND NOT (e.id = ANY(?))";
    await execClient(
      client,
      `DELETE FROM events e
       WHERE NOT EXISTS (SELECT 1 FROM _pool_keep k WHERE k.id = e.id)
       AND NOT EXISTS (SELECT 1 FROM room_timeline rt WHERE rt.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM room_deck rd WHERE rd.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM room_hand rh WHERE rh.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.initial_event_id = e.id)${liveClause}`,
      liveHeld.length === 0 ? [] : [liveHeld],
    );
    const afterRow = await queryOneClient<{ c: unknown }>(
      client,
      "SELECT COUNT(*)::int AS c FROM events",
      [],
    );
    const after = rowCount(afterRow, "c");
    return before - after;
  });
}

export function applyMaxTotalToMerged(merged: PoolEventLike[]): PoolEventLike[] {
  const sorted = [...merged].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
  const max = config.eventPoolMaxTotal;
  if (max == null || sorted.length <= max) return sorted;
  return sorted.slice(0, max);
}

export async function commitMergedPool(merged: PoolEventLike[]): Promise<{
  finalCount: number;
  orphansRemoved: number;
  expiredRemoved: number;
}> {
  const canonical = applyMaxTotalToMerged(merged);
  await upsertMergedPool(canonical);
  const keep = new Set(canonical.map((e) => e.id));
  const orphansRemoved = await removePoolEventsNotInMerged(keep);
  const expiredRemoved = await deleteExpiredEvents();
  clearEventCache();
  return {
    finalCount: await getEventCount(),
    orphansRemoved,
    expiredRemoved,
  };
}

const INSERT_SEED_SQL = `
  INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export async function writePoolToDb(events: PoolEventLike[]): Promise<void> {
  const now = new Date().toISOString();
  await withTransaction(async (client) => {
    await execClient(client, "DELETE FROM events", []);
    for (const e of events) {
      await execClient(client, INSERT_SEED_SQL, [
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
      ]);
    }
    await setLastRefreshed(client);
  });
  clearEventCache();
}

export function runRefreshEventPool(): Promise<void> {
  console.log(
    `[events] Refresh started: merge in memory (≤${config.eventStoreLimitPerCategory}/category), then upsert + TTL (~${config.eventPoolTtlMinutes} min).`,
  );
  return (async () => {
    let existing = await loadExistingPool();

    for await (const { categoryKey: _key, events } of fetchCategoriesIncremental()) {
      if (events.length === 0) continue;
      existing = mergeWithExistingPool(existing, events, config.eventStoreLimitPerCategory);
    }

    const { finalCount, orphansRemoved, expiredRemoved } = await commitMergedPool(existing);
    if (orphansRemoved > 0) console.log(`[events] Removed ${orphansRemoved} orphan pool rows (replaced / over cap).`);
    if (expiredRemoved > 0) {
      console.log(
        `[events] Pruned ${expiredRemoved} TTL-expired events (older than ${config.eventPoolTtlMinutes} min, floor ${MIN_EVENTS_TO_START}).`,
      );
    }
    console.log(`[events] Refresh done: pool has ${finalCount} events.`);
  })();
}

function refreshEventPoolInBackground(): void {
  runRefreshEventPool().catch((err) => console.error("[events] Background refresh failed:", err));
}

export async function ensureEventPool(): Promise<void> {
  const count = await getEventCount();

  if (count === 0 && seedPath && existsSync(seedPath)) {
    const raw = readFileSync(seedPath, "utf8");
    const pool: PoolEvent[] = JSON.parse(raw);
    const now = new Date().toISOString();
    await withTransaction(async (client) => {
      await execClient(client, "DELETE FROM events", []);
      for (const e of pool) {
        await execClient(client, INSERT_SEED_SQL, [
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
        ]);
      }
      await setLastRefreshed(client);
    });
    clearEventCache();
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
    const after = await getEventCount();
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
