-- Party Timeliners — PostgreSQL schema (Supabase / managed Postgres)
-- Run once via: npm run db:migrate   OR paste into Supabase SQL Editor

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  display_title TEXT NOT NULL,
  year INTEGER NOT NULL,
  image TEXT,
  wikipedia_url TEXT,
  popularity_score INTEGER,
  refreshed_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS event_pool_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Party Timeliners',
  status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'ended')) DEFAULT 'lobby',
  host_player_id TEXT,
  initial_event_id TEXT REFERENCES events (id),
  next_deck_sequence INTEGER NOT NULL DEFAULT 0,
  turn_index INTEGER NOT NULL DEFAULT 0,
  turn_started_at TEXT,
  max_timeline_size INTEGER,
  points_to_win INTEGER,
  turn_time_limit_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (to_char (CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  started_at TEXT,
  ended_at TEXT,
  winner_player_id TEXT
);

CREATE TABLE IF NOT EXISTS room_players (
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT,
  email TEXT,
  is_host INTEGER NOT NULL DEFAULT 0,
  turn_order INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  connected INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (to_char (CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (room_id, player_id)
);

CREATE TABLE IF NOT EXISTS room_timeline (
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events (id),
  position INTEGER NOT NULL,
  placed_by_player_id TEXT,
  placed_at TEXT NOT NULL DEFAULT (to_char (CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (room_id, position)
);

CREATE TABLE IF NOT EXISTS room_deck (
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events (id),
  sequence INTEGER NOT NULL,
  PRIMARY KEY (room_id, sequence)
);

CREATE TABLE IF NOT EXISTS room_hand (
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events (id),
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0 AND slot_index <= 2),
  PRIMARY KEY (room_id, player_id, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_room_timeline_room ON room_timeline (room_id);
CREATE INDEX IF NOT EXISTS idx_room_deck_room ON room_deck (room_id);
CREATE INDEX IF NOT EXISTS idx_room_hand_room ON room_hand (room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_room ON room_players (room_id);

-- Idempotent for existing databases created before streak column
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS streak INTEGER NOT NULL DEFAULT 0;

-- End-of-match snapshots (gameplay state is in-memory; rows inserted when a match finishes or room closes)
CREATE TABLE IF NOT EXISTS room_match_metrics (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  ended_at TEXT,
  winner_player_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_room_match_metrics_room ON room_match_metrics (room_id);
