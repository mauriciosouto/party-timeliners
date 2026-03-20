const env = process.env;

function parseOptionalPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** TTL: prefer EVENT_POOL_TTL_MINUTES if set; else EVENT_POOL_TTL_DAYS (default 30 ≈ 1 month). */
function eventPoolTtlMinutesFromEnv(): number {
  if (env.EVENT_POOL_TTL_MINUTES != null && env.EVENT_POOL_TTL_MINUTES !== "") {
    return Number(env.EVENT_POOL_TTL_MINUTES) || 43200;
  }
  const days = parseOptionalPositiveInt(env.EVENT_POOL_TTL_DAYS, 30);
  return days * 24 * 60;
}

/** Max rows in pool after merge; set EVENT_POOL_MAX_TOTAL=0 or "unlimited" for no cap. */
function eventPoolMaxTotalFromEnv(): number | null {
  const raw = env.EVENT_POOL_MAX_TOTAL;
  if (raw == null || raw === "") return 10_000;
  const lower = raw.toLowerCase();
  if (raw === "0" || lower === "unlimited") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

export const config = {
  port: Number(env.PORT) || 3001,
  dbPath: env.DB_PATH || "data/game.db",
  nodeEnv: env.NODE_ENV || "development",
  /** Optional: set REFRESH_SECRET to require x-refresh-secret header on POST /api/admin/refresh-events */
  refreshSecret: env.REFRESH_SECRET || undefined,
  /** Per-event TTL in minutes (age from created_at, fallback refreshed_at). Default ≈ 30 days unless EVENT_POOL_TTL_MINUTES is set. */
  eventPoolTtlMinutes: eventPoolTtlMinutesFromEnv(),
  /**
   * Max events stored per category when merging Wikidata into the pool (not the SPARQL phase1 limit).
   * Override with EVENT_STORE_LIMIT_PER_CATEGORY.
   */
  eventStoreLimitPerCategory: parseOptionalPositiveInt(env.EVENT_STORE_LIMIT_PER_CATEGORY, 400),
  /** Optional global cap after merge (by popularity). null = no cap. */
  eventPoolMaxTotal: eventPoolMaxTotalFromEnv(),
};
