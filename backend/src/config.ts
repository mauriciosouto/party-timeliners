const env = process.env;

export const config = {
  port: Number(env.PORT) || 3001,
  dbPath: env.DB_PATH || "data/game.db",
  nodeEnv: env.NODE_ENV || "development",
  /** Optional: set REFRESH_SECRET to require x-refresh-secret header on POST /api/admin/refresh-events */
  refreshSecret: env.REFRESH_SECRET || undefined,
  /** Per-event TTL in minutes. Events with refreshed_at older than this are removed on each refresh; new ingestion refills. Default: 1 month (43200). Override with EVENT_POOL_TTL_MINUTES. */
  eventPoolTtlMinutes: Number(env.EVENT_POOL_TTL_MINUTES) || 43200,
};
