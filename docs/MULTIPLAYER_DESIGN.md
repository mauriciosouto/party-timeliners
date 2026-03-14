# Multiplayer Architecture Design — Party Timeliners

This document proposes the evolution from the current single-player backend to a room-based multiplayer system compatible with **Cloudflare Workers** and **Durable Objects**, and implementable today with the existing Node + SQLite stack as a reference.

**No code is generated here; only data models, protocol, room state, and turn lifecycle are defined.**

---

## 1. Updated Data Models

### 1.1 Conceptual Shift

| Before (single-player) | After (multiplayer) |
|------------------------|---------------------|
| **Game** = one play session, one implicit player | **Room** = one game session; contains multiple players and one shared timeline |
| No notion of “who is playing” | **Players** join a room; **room_players** links players to a room with role, score, turn order |
| Game starts immediately | **Lobby** phase: players join; host starts when ready (min 1 player) |
| Single actor places events | **Turns**: one player at a time places an event; turn order is fixed for the match |

The **events** table (global pool from Wikidata) is unchanged. Timeline validation rules stay the same; only the owner of the action and the scoring subject change (per-player score, not a single game score).

---

### 1.2 Entities

#### **rooms**

A room is the top-level container for one game session (lobby → playing → ended). Aligns with one Durable Object instance in the CF design.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Room id (UUID or slug). Used in invitation link and as DO id. |
| name | TEXT | Room name (host-configurable in lobby). |
| status | TEXT | `lobby` \| `playing` \| `ended`. |
| host_player_id | TEXT FK | Which room_player is the host (can start game, change settings in lobby). |
| initial_event_id | TEXT FK | First event on the shared timeline (set when game starts). |
| next_deck_sequence | INTEGER | Index of next event to draw from this room’s deck. |
| turn_index | INTEGER | Index into turn order (which room_player’s turn it is). 0-based. |
| max_timeline_size | INTEGER | Optional cap (e.g. 50); game ends when timeline reaches this. Null = no cap. |
| points_to_win | INTEGER | Optional; null = play until deck/limit. |
| turn_time_limit_seconds | INTEGER | Optional; null = no limit. |
| created_at | TEXT | ISO 8601. |
| started_at | TEXT | ISO 8601; set when status becomes `playing`. |
| ended_at | TEXT | ISO 8601; set when status becomes `ended`. |

#### **players** (optional global table)

If you need a stable identity across rooms (e.g. for reconnection by email):

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Stable player id (e.g. UUID). |
| nickname | TEXT | Display name. |
| email | TEXT | For reconnection; optional. |

If you keep everything room-scoped and identify only by connection, you can omit a global `players` table and store nickname/email only in **room_players**.

#### **room_players**

Junction table: who is in the room, with per-room state. One row per (room, player). In a Durable Object, this can be an in-memory list keyed by connection id or player id.

| Column | Type | Description |
|--------|------|-------------|
| room_id | TEXT FK | References rooms.id. |
| player_id | TEXT | Player id (or connection id if no global players). PK part 1. |
| nickname | TEXT | Display name in this room. |
| email | TEXT | Optional; for reconnection. |
| is_host | BOOLEAN | True for the room host. |
| turn_order | INTEGER | 0-based order in the turn cycle. Set when game starts (random). |
| score | INTEGER | Correct placements in this match. |
| connected | BOOLEAN | WebSocket currently open. |
| joined_at | TEXT | ISO 8601. |

Composite PK: `(room_id, player_id)`.

- **Lobby**: all joined players are listed; `turn_order` and `score` can be null/0 until the game starts.
- **Game start**: assign `turn_order` randomly (or host-first, then random), set `score = 0` for everyone.

#### **room_timeline**

Same as current **game_timeline**, but keyed by room. Shared timeline for the whole room.

| Column | Type | Description |
|--------|------|-------------|
| room_id | TEXT FK | References rooms.id. |
| event_id | TEXT FK | References events.id. |
| position | INTEGER | Order on timeline (0, 1, 2, …). |
| placed_by_player_id | TEXT | Who placed this event (for scoring and optional UI). |
| placed_at | TEXT | ISO 8601. |

Unique on `(room_id, position)`.

#### **room_deck**

Same as current **game_deck**, keyed by room. Shuffled when the game starts.

| Column | Type | Description |
|--------|------|-------------|
| room_id | TEXT FK | References rooms.id. |
| event_id | TEXT FK | References events.id. |
| sequence | INTEGER | Draw order (0, 1, …). |

PK `(room_id, sequence)`.

#### **room_player_hands** (optional)

If the server must remember each player’s current card (for reconnect / audit):

| Column | Type | Description |
|--------|------|-------------|
| room_id | TEXT FK | References rooms.id. |
| player_id | TEXT | References room_players.player_id. |
| event_id | TEXT FK | Current event to place (one per active turn). |
| dealt_at | TEXT | ISO 8601. |

Alternatively, the “current event” can be derived from turn state and deck (next event in deck is the current turn holder’s card) and not stored separately.

---

### 1.3 Summary Table Mapping

| Old (single-player) | New (multiplayer) |
|--------------------|-------------------|
| games | rooms |
| (implicit single player) | room_players (+ optional players) |
| game_timeline | room_timeline (+ placed_by_player_id) |
| game_deck | room_deck |
| games.score | room_players.score |
| games.next_deck_sequence | rooms.next_deck_sequence |
| — | rooms.turn_index, rooms.host_player_id, rooms.status, lobby settings |

---

## 2. Room State Structure

This is the **single source of truth** that the server (or Durable Object) maintains and broadcasts. Clients never authoritatively hold game state; they receive snapshots and deltas.

### 2.1 Full Room State (server-side / broadcast payload)

```ts
type RoomStatus = "lobby" | "playing" | "ended";

type RoomState = {
  roomId: string;
  name: string;
  status: RoomStatus;
  hostPlayerId: string | null;
  // Lobby-only (or persisted settings)
  maxTimelineSize: number | null;
  pointsToWin: number | null;
  turnTimeLimitSeconds: number | null;

  players: RoomPlayerState[];
  timeline: TimelineEntryState[];
  scores: Record<string, number>;  // playerId -> score (redundant with players[].score)

  // When status === "playing"
  turnOrder: string[];           // playerIds in order of turns
  currentTurnPlayerId: string | null;
  currentTurnStartedAt: string | null;  // ISO 8601, for optional timer
  nextDeckSequence: number;
  initialEventId: string | null;

  // When status === "ended"
  endedAt: string | null;
  winnerPlayerId: string | null;  // highest score; tie = null or first
};
```

### 2.2 RoomPlayerState

```ts
type RoomPlayerState = {
  playerId: string;
  nickname: string;
  isHost: boolean;
  score: number;        // 0 in lobby; updated during play
  turnOrder: number | null;  // 0-based; null in lobby
  connected: boolean;
  joinedAt: string;
};
```

### 2.3 TimelineEntryState

```ts
type TimelineEntryState = {
  event: ApiEvent;      // id, title, year, displayTitle, image, wikipediaUrl
  position: number;
  placedByPlayerId: string | null;
  placedAt: string;
};
```

### 2.4 Lobby vs Playing vs Ended

- **lobby**: `timeline` can be empty; `turnOrder` / `currentTurnPlayerId` / `nextDeckSequence` unused or default. `players` list is the join list; host can start when ready (min 1 player).
- **playing**: `timeline` has at least the initial event; `turnOrder` is fixed; `currentTurnPlayerId` is whose turn it is; only that player can send `place_event`; validation and scoring run as today.
- **ended**: `status === "ended"`; `winnerPlayerId` and `endedAt` set; no further placements. Clients can show results and “play again” (new room or reset same room).

---

## 3. WebSocket Event Protocol

All messages are JSON. Client → Server are **actions**; Server → Client are **events** (state updates and acknowledgments).

### 3.1 Client → Server (actions)

| Action | Payload | When |
|--------|---------|------|
| `join_room` | `{ roomId, nickname, email?, playerId? }` | On load or reconnect. Server assigns or confirms `playerId`, adds to room_players, marks connected. |
| `leave_room` | `{}` or `{ playerId }` | Player leaves; server marks disconnected or removes from room_players. |
| `set_nickname` | `{ nickname }` | Lobby only; update display name. |
| `set_room_settings` | `{ name?, maxTimelineSize?, pointsToWin?, turnTimeLimitSeconds? }` | Lobby only; host only. |
| `start_game` | `{}` | Lobby only; host only. Min 1 player. Server sets status = playing, builds deck, assigns turn order, deals first card to first player. |
| `place_event` | `{ eventId, position }` | Playing only; current turn player only. Same semantics as current POST /games/:id/place. Server validates, updates timeline and score, advances turn or ends game. |
| `ping` | `{}` | Optional; server responds with `pong`. |

### 3.2 Server → Client (events)

| Event | Payload | When |
|-------|---------|------|
| `room_state` | `RoomState` | Full state. Sent on join, after any action that changes state, and on reconnect. |
| `room_state_delta` | `Partial<RoomState>` | Optional; for efficiency, only changed fields. |
| `join_ack` | `{ playerId, roomState }` | After successful join_room. |
| `join_error` | `{ code, message }` | e.g. room full, game already started. |
| `place_result` | `{ correct, gameEnded?, correctPosition?, score, timeline, nextEvent?, nextTurnPlayerId? }` | After place_event; same shape as current REST place response, plus nextTurnPlayerId. |
| `place_error` | `{ code, message }` | Not your turn, invalid position, game ended, etc. |
| `turn_started` | `{ playerId, event, turnStartedAt? }` | When a new turn begins (after a correct place or after skip). |
| `game_ended` | `{ winnerPlayerId, scores, timeline }` | When status becomes ended (wrong placement, deck empty, or max timeline reached). |
| `player_joined` | `{ player: RoomPlayerState }` | Broadcast when someone joins (lobby). |
| `player_left` | `{ playerId }` | Broadcast when someone leaves or disconnects. |
| `pong` | `{}` | Response to ping. |

### 3.3 Connection Lifecycle

1. Client opens WebSocket to `/ws/rooms/:roomId` (or Worker route that resolves room DO).
2. Client sends `join_room` with roomId, nickname, optional email/playerId.
3. Server validates (room exists, status is lobby or allow reconnect), adds/updates room_players, sets connected = true.
4. Server sends `join_ack` with playerId and full `room_state`.
5. Server broadcasts `player_joined` to other clients (in lobby).
6. From then on, client sends actions; server applies them, updates room state, and sends `room_state` (or deltas) and any specific events (`place_result`, `turn_started`, `game_ended`, etc.).
7. On disconnect: server sets room_players.connected = false; broadcasts `player_left`. If it was the current turn player, apply turn-skip rule (see Turn Lifecycle).
8. Reconnect: same `join_room` with same playerId/email; server restores connected and resends full `room_state`.

---

## 4. Turn Lifecycle

### 4.1 When the Game Starts (lobby → playing)

1. Host sends `start_game`.
2. Server checks: status === `lobby`, at least 1 player, requester is host.
3. Server:
   - Sets `rooms.status = 'playing'`, `started_at = now()`.
   - Picks random `initial_event_id`, inserts one row into `room_timeline` (position 0, placed_by optional).
   - Builds `room_deck` (shuffle N events from pool, exclude initial), sets `next_deck_sequence = 0`.
   - Assigns `turn_order` to each room_player (e.g. random shuffle of player ids), sets `turn_index = 0`, `currentTurnPlayerId = turnOrder[0]`.
   - Deals “current event” to the first player (next event from deck; optionally store in room_player_hands or derive from deck + turn).
4. Server broadcasts `room_state` (status playing, timeline, turnOrder, currentTurnPlayerId, first player’s event if included in state).

### 4.2 During a Turn (playing)

1. Only `currentTurnPlayerId` can send `place_event`.
2. Server receives `place_event` with `eventId` and `position`.
   - Validates: room status is playing, requester is current turn player, eventId is the one dealt to that player (or next in deck).
   - Runs **existing timeline validation** (chronological bounds). No change to validation logic.
3. If **correct**:
   - Insert event into `room_timeline` at `position`, set `placed_by_player_id` to current player.
   - Increment that player’s `score` in room_players.
   - Advance deck: `next_deck_sequence += 1`.
   - Check end conditions: deck empty, or timeline size >= max_timeline_size, or someone >= points_to_win. If any, go to **Game End**.
   - Otherwise: advance turn: `turn_index = (turn_index + 1) % turnOrder.length`; new `currentTurnPlayerId = turnOrder[turn_index]`. Deal next event from deck to the new current player.
   - Send `place_result` (correct, new score, timeline, nextEvent, nextTurnPlayerId). Broadcast `room_state` or delta.
   - Optionally send `turn_started` to all (new player, new event).
4. If **incorrect** (current rule: game ends):
   - Set `rooms.status = 'ended'`, `ended_at = now()`, compute `winner_player_id` (max score).
   - Send `place_result` (correct: false, gameEnded: true, correctPosition, scores, timeline). Broadcast `game_ended` and full `room_state`.

### 4.3 Turn Skip (disconnect during turn)

- If the current turn player disconnects (WebSocket closes, or heartbeat timeout):
  - Server advances turn: same as “correct” but without placing (skip this turn, no score change, next player gets the **same** event or the next one from deck—design choice: skip card or give card to next player).
  - Broadcast updated state and `turn_started` for the new current player.

### 4.4 Game End

- When deck is exhausted, or timeline reaches max size, or points_to_win is reached (if set), or on first incorrect placement:
  - Set `rooms.status = 'ended'`, `ended_at`, `winner_player_id`.
  - Broadcast `game_ended` and full `room_state`.
- After that, no more `place_event`; clients show results. “Play again” creates a new room or resets the same room (new lobby, clear timeline/deck, same or new players).

### 4.5 Optional: Turn Timer

- If `turn_time_limit_seconds` is set, server (or DO) starts a timer when a turn starts.
- If timer fires before `place_event`: treat as wrong placement (or as skip—design choice). Then advance turn or end game accordingly.

---

## 5. Compatibility with Cloudflare Workers + Durable Objects

- **One room = one Durable Object**. The DO id can be the room id. The DO holds in memory the same `RoomState` (and optionally persists to DO storage for durability). No SQLite in the Worker; SQLite can remain the reference implementation for a standalone Node server.
- **WebSocket**: Worker receives WebSocket upgrade, routes by room id to the DO. The DO handles the protocol above and broadcasts to all connections in that room.
- **Events pool**: DO (or Worker) can call an HTTP API or a separate service to get the event pool / next event, or the pool can be loaded once per room at start and stored in DO storage. Current ingestion (Wikidata → eventPool.json → events table) stays; the “room” backend or DO fetches from that pool when building the deck.
- **Validation**: The same chronological validation logic runs inside the DO (or Node service) when processing `place_event`; no change to rules.

---

## 6. What Stays the Same

- **Timeline validation**: `prevYear <= event.year <= nextYear` (with boundaries). Correct → event stays and score +1; incorrect → game ends (current rule).
- **Event shape**: id, title, year, displayTitle, image, wikipediaUrl.
- **Deck building**: Shuffle from global pool, one initial event on timeline, rest in deck; draw in order.
- **Events table**: Unchanged; source of truth for the pool.

---

## 7. Implementation Order (for later)

1. Refactor DB and services: games → rooms, add room_players, room_timeline, room_deck; keep validation.
2. Add REST or WS endpoints for join/leave and room state (still REST if easier).
3. Implement lobby (status lobby, start_game, settings).
4. Implement turn order and turn_index; restrict place to current player; add turn_started / game_ended.
5. Add WebSocket transport and replace or complement REST with the protocol above.
6. Add reconnection (playerId/email) and turn-skip on disconnect.
7. Optional: turn timer, points_to_win, max_timeline_size.

This design document is the single reference for the multiplayer evolution; implementation can follow it step by step while keeping the current timeline validation logic intact.
