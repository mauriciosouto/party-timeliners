const env = process.env;

export const config = {
  port: Number(env.PORT) || 3001,
  dbPath: env.DB_PATH || "data/game.db",
  nodeEnv: env.NODE_ENV || "development",
  /** Optional: set REFRESH_SECRET to require x-refresh-secret header on POST /api/admin/refresh-events */
  refreshSecret: env.REFRESH_SECRET || undefined,
  /** Event pool TTL in minutes. After this time, events are replaced on next startup. Default 15 for testing; use 1440 for 24h. */
  eventPoolTtlMinutes: Number(env.EVENT_POOL_TTL_MINUTES) || 15,
};
