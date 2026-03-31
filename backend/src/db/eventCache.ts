/**
 * In-memory cache of `events` rows to cut Supabase/Postgres round-trips during play.
 * Invalidated when the pool is rewritten (seed, refresh, merge).
 */
import type { EventRecord } from "../types.js";
import { queryOne, queryRows } from "./index.js";

const cache = new Map<string, EventRecord>();

export function primeEventCache(rows: readonly EventRecord[]): void {
  for (const e of rows) {
    cache.set(e.id, e);
  }
}

export function clearEventCache(): void {
  cache.clear();
}

export function getCachedEvent(id: string): EventRecord | undefined {
  return cache.get(id);
}

/** Single-row lookup: RAM first, then Postgres (and store). */
export async function getEventRecord(id: string): Promise<EventRecord | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await queryOne<EventRecord>("SELECT * FROM events WHERE id = ?", [id]);
  if (row) cache.set(id, row);
  return row ?? null;
}

/** Batch-load any ids not yet in cache (one query). */
export async function ensureEventIdsInCache(ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  const missing = unique.filter((id) => !cache.has(id));
  if (missing.length === 0) return;

  const rows = await queryRows<EventRecord>("SELECT * FROM events WHERE id = ANY(?)", [missing]);
  for (const r of rows) {
    cache.set(r.id, r);
  }
}
