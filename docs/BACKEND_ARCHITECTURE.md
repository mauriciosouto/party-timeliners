# Backend Architecture — Party Timeliners

Single-player timeline card game backend. Players place historical events in chronological order; the server validates each move and ends the game on first incorrect placement.

---

## 1. Database Schema (SQLite)

### Tables

| Table         | Purpose |
|---------------|---------|
| `events`      | Global pool of events (from Wikidata ingestion). Read-only at runtime. |
| `games`       | One row per game. Tracks status, score, and deck cursor. |
| `game_timeline` | Ordered list of events placed on the timeline for each game. |
| `game_deck`   | Per-game deck of events to draw. Shuffled at game creation. |

### `events`

| Column         | Type    | Description |
|----------------|---------|--------------|
| id             | TEXT PK | Wikidata Q-id (e.g. Q12345). |
| title          | TEXT    | Event title. |
| type           | TEXT    | Category (Film, Book, …). |
| display_title  | TEXT    | `"Title (Type)"` for UI. |
| year           | INTEGER | Event year (negative = BCE). |
| image          | TEXT    | Thumbnail URL. |
| wikipedia_url  | TEXT    | Wikipedia link. |

### `games`

| Column             | Type    | Description |
|--------------------|---------|-------------|
| id                 | TEXT PK | UUID. |
| status             | TEXT    | `active` \| `ended`. |
| score              | INTEGER | Number of correct placements. |
| initial_event_id   | TEXT FK | First event on timeline (seed). |
| next_deck_sequence | INTEGER | Index of next event to draw from deck. |
| created_at         | TEXT    | ISO 8601. |

### `game_timeline`

| Column    | Type    | Description |
|-----------|---------|--------------|
| game_id   | TEXT FK | References games.id. |
| event_id  | TEXT FK | References events.id. |
| position  | INTEGER | Order on timeline (0, 1, 2, …). |
| placed_at | TEXT    | ISO 8601. |

Unique on `(game_id, position)`.

### `game_deck`

| Column   | Type    | Description |
|----------|---------|--------------|
| game_id  | TEXT FK | References games.id. |
| event_id | TEXT FK | References events.id. |
| sequence | INTEGER | Draw order (0, 1, …). |

Used as a fixed deck: `next_deck_sequence` on `games` points to the next row to serve.

---

## 2. API Endpoints

Base path: `/api` (e.g. `http://localhost:3001/api`).

| Method | Path | Description |
|--------|------|-------------|
| POST   | /games | Create a new game. Returns game id, initial timeline, and first event to place. |
| GET    | /games/:id | Get game state (status, score, timeline). |
| GET    | /games/:id/next-event | Get next event to place. 404 when no more or game ended. |
| POST   | /games/:id/place | Submit placement. Validates; if wrong, ends game. |

### POST /games

**Response** `201`:

```json
{
  "gameId": "uuid",
  "status": "active",
  "score": 0,
  "timeline": [{ "event": { "id", "title", "year", "displayTitle", "image", "wikipediaUrl" }, "position": 0 }],
  "nextEvent": { "id", "title", "year", "displayTitle", "image", "wikipediaUrl" }
}
```

- Timeline has one event (initial seed).  
- `nextEvent` is the first card the player must place.

### GET /games/:id

**Response** `200`:

```json
{
  "gameId": "uuid",
  "status": "active",
  "score": 2,
  "timeline": [
    { "event": { "id", "title", "year", "displayTitle", "image", "wikipediaUrl" }, "position": 0 },
    { "event": { ... }, "position": 1 }
  ]
}
```

### GET /games/:id/next-event

**Response** `200`: same `nextEvent` shape as above.  
**Response** `404`: no more events or game ended.

### POST /games/:id/place

**Body**:

```json
{
  "eventId": "Q12345",
  "position": 1
}
```

`position` = index where the card is inserted (0 = before first, 1 = between first and second, …).

**Response** `200` (correct):

```json
{
  "correct": true,
  "score": 3,
  "timeline": [ ... ],
  "nextEvent": { ... }
}
```

**Response** `200` (incorrect — game ends):

```json
{
  "correct": false,
  "gameEnded": true,
  "correctPosition": 2,
  "score": 2,
  "timeline": [ ... ]
}
```

No `nextEvent` when game has ended.

**Response** `400`: invalid body or game already ended.  
**Response** `404`: game or event not found.

---

## 3. Backend Architecture (Layered)

```
backend/
├── src/
│   ├── index.ts          # Express app, CORS, mount routes, start server
│   ├── config.ts         # Port, DB path, env
│   ├── db/
│   │   ├── index.ts      # SQLite connection, run schema
│   │   ├── schema.sql    # CREATE TABLEs
│   │   └── seed.ts       # Load events from JSON into `events` table
│   ├── routes/
│   │   └── games.ts      # POST/GET /games, GET /games/:id/next-event, POST /games/:id/place
│   ├── services/
│   │   └── gameService.ts # Create game, get state, draw next, validate place
│   └── types.ts          # Shared types (Game, Event, etc.)
├── data/
│   └── eventPool.json    # Copy or symlink from frontend for seeding
├── package.json
└── tsconfig.json
```

- **Routes**: parse request, call service, send response.  
- **Services**: all game and persistence logic; use `db` to read/write.  
- **DB**: run schema, expose a single module that returns a `Database` (e.g. better-sqlite3).  
- **Seed**: one-time or on-empty load of `eventPool.json` into `events`.

---

## 4. Game Rules (Server)

- **Create game**: Pick one random event as `initial_event_id`, insert one row into `game_timeline`. Build deck of N (e.g. 200) other events, shuffle, insert into `game_deck`. Set `next_deck_sequence = 0`.
- **Next event**: Return `game_deck` row where `game_id` and `sequence = next_deck_sequence`. Increment `next_deck_sequence`. If no row, return 404 (round complete). If `status === 'ended'`, return 404.
- **Place**:  
  - Load current timeline (ordered by position).  
  - Insert new event at `position` (shift positions if needed).  
  - Check: `timeline[position-1].year <= event.year <= timeline[position].year` (with bounds).  
  - If invalid: set `games.status = 'ended'`, return `correct: false, gameEnded: true`.  
  - If valid: insert into `game_timeline`, increment `games.score`, return `correct: true` and next event (if any).

---

## 5. Scalability Notes

- Single SQLite file per environment; no connection pool. For multiple processes, use a single process or move to PostgreSQL later.
- Events table is append-only (re-seed by truncate + insert). Games and related tables grow with play; add cleanup or archival if needed.
- API is stateless; game state is always read from DB. Easy to add auth (e.g. player id or session) and scope games by user later.

---

## 6. Production Deployment

**Backend hosting:** [Render](https://render.com)

**Production URL:**  
https://party-timeliners.onrender.com

**Health check:**  
`GET /health`

Returns `{ "status": "ok" }`. This endpoint is used for monitoring and uptime checks (e.g. Render health checks or external ping services).
