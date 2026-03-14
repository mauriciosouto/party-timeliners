-- Party Timeliners — SQLite schema (multiplayer rooms)
-- Run once on first start or via seed/migrate script.

-- Global event pool (populated from Wikidata / eventPool.json)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  display_title TEXT NOT NULL,
  year INTEGER NOT NULL,
  image TEXT,
  wikipedia_url TEXT,
  popularity_score INTEGER
);

-- When the event pool was last refreshed (for TTL / expiration)
CREATE TABLE IF NOT EXISTS event_pool_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Drop old single-player tables if present (migration)
DROP TABLE IF EXISTS game_deck;
DROP TABLE IF EXISTS game_timeline;
DROP TABLE IF EXISTS games;

-- One row per room (game session)
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Party Timeliners',
  status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'ended')) DEFAULT 'lobby',
  host_player_id TEXT,
  initial_event_id TEXT REFERENCES events(id),
  next_deck_sequence INTEGER NOT NULL DEFAULT 0,
  turn_index INTEGER NOT NULL DEFAULT 0,
  turn_started_at TEXT,
  max_timeline_size INTEGER,
  points_to_win INTEGER,
  turn_time_limit_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  ended_at TEXT,
  winner_player_id TEXT
);

-- Players in a room (lobby + per-player score and turn order)
CREATE TABLE IF NOT EXISTS room_players (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  email TEXT,
  is_host INTEGER NOT NULL DEFAULT 0,
  turn_order INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  connected INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (room_id, player_id)
);

-- Shared timeline per room
CREATE TABLE IF NOT EXISTS room_timeline (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  position INTEGER NOT NULL,
  placed_by_player_id TEXT,
  placed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (room_id, position)
);

-- Deck per room (shuffled when game starts)
CREATE TABLE IF NOT EXISTS room_deck (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  sequence INTEGER NOT NULL,
  PRIMARY KEY (room_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_room_timeline_room ON room_timeline(room_id);
CREATE INDEX IF NOT EXISTS idx_room_deck_room ON room_deck(room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_room ON room_players(room_id);
