# Party Timeliners — Backend

Node.js + Express API, WebSocket server, and **PostgreSQL** persistence (Supabase or any Postgres) for the **multiplayer** timeline card game.

## Setup

```bash
cd backend
npm install
```

## Database and seed

1. Set **`DATABASE_URL`** to your Postgres connection string (Supabase: *Project Settings → Database → Connection string*, URI mode).

2. Create tables: either start the server once (auto-migration if `events` is missing), run **`npm run db:migrate`**, or paste **`src/db/schema.pg.sql`** in the Supabase SQL editor.

3. Create the events pool (one-time). Copy the frontend pool or set `SEED_PATH`:

   ```bash
   mkdir -p data
   cp ../frontend/data/eventPool.json data/
   ```

4. Seed the database:

   ```bash
   npm run seed
   ```

   This populates the `events` table. Required before starting games.

## Run

```bash
# Development (watch)
npm run dev

# Production
npm run build && npm start
```

Server listens on `http://localhost:3001` (or `PORT` env).  
WebSocket: `ws://localhost:3001/ws`

Opening the backend URL in a browser shows a **status page** with basic metrics: events in pool, total rooms, rooms in lobby, active games (playing), and rooms ended.

## API (REST)

- `POST /api/rooms` — Create room. Body: `{ "nickname", "name"?(optional) }`. Returns `roomId`, `playerId`, `roomState`.
- `GET /api/rooms/:id` — Room state (players, timeline, status, scores, turn).
- `POST /api/rooms/:id/join` — Join room (lobby). Body: `{ "nickname", "email"?(optional) }`. Returns `playerId`, `roomState`.
- `POST /api/rooms/:id/start` — Start game (host only). Body: `{ "playerId" }`. Returns full `roomState`.
- `GET /api/rooms/:id/next-event?playerId=...` — Next event for current turn player. 404 if not your turn or no event.
- `POST /api/rooms/:id/place` — Place event. Body: `{ "playerId", "eventId", "position" }`. Returns place result.

## WebSocket (path: `/ws`)

Connect then send JSON messages:

- **Client → Server**
  - `join_room`: `{ "type": "join_room", "roomId", "nickname", "playerId"?(reconnect), "email"?(optional) }`
  - `start_game`: `{ "type": "start_game" }` (host only)
  - `place_event`: `{ "type": "place_event", "eventId", "position" }` (current turn player only)
  - `ping`: `{ "type": "ping" }`

- **Server → Client**
  - `join_ack`: `{ "type": "join_ack", "playerId", "roomState" }`
  - `join_error`: `{ "type": "join_error", "code", "message" }`
  - `room_state`: `{ "type": "room_state", "roomState" }` (broadcast on any change)
  - `place_result`: `{ "type": "place_result", "correct", "score", "timeline", "nextEvent"?, "nextTurnPlayerId"?, "gameEnded"? }`
  - `place_error`: `{ "type": "place_error", "code", "message" }`
  - `pong`: `{ "type": "pong" }`

## Testing

Tests use [Vitest](https://vitest.dev/): **unit tests** (pure logic) and **integration tests** (room service against PostgreSQL).

### How to run

| Script | Description |
|--------|-------------|
| `npm run test` | Run all tests (unit + integration). |
| `npm run test:coverage` | Tests + coverage (terminal + `coverage/` with HTML and `lcov.info`). |
| `npm run test:watch` | Watch mode: re-runs on file save. |
| `npm run test:coverage:integration` | Integration tests only, with coverage. |

From the repo root: `cd backend` then run the command above.

### Coverage on GitHub

The workflow [../.github/workflows/test.yml](../.github/workflows/test.yml) runs on every push and pull request:

- **Job status** in the *Actions* tab (pass/fail).
- **Artifact *coverage-report***: in each run you can download the ZIP with the `coverage/` folder; open `index.html` in your browser to view the full report.
- **Codecov (optional):** for a coverage badge and diff on PRs, connect the repo at [codecov.io](https://codecov.io) and add the token in *Settings → Secrets* as `CODECOV_TOKEN`.

### What's covered

| Area | File | Description |
|------|------|-------------|
| Event quality | `src/game/eventQuality.test.ts` | `isGoodEvent`, `filterGoodEvents` |
| Timeline | `src/game/timeline.test.ts` | `isValidPosition`, `findCorrectPosition`, `isCorrectPlacement` |
| Validation | `src/game/validation.test.ts` | `validatePlace`, `getNextTurnPlayerId` |
| Deck | `src/game/deck.test.ts` | `shuffle`, `buildDeck` |
| Event ingestion | `src/services/eventIngestion.test.ts` | `mergeWithExistingPool` |
| Room (integration) | `src/services/roomService.integration.test.ts` | createRoom, joinRoom, startGame, placeEvent, endGame, rematch with real DB |

Integration tests run only when **`DATABASE_URL`** or **`TEST_DATABASE_URL`** is set (CI uses a Postgres service). They seed `events` and clear room tables between tests.

## Env

| Variable   | Default        | Description        |
|-----------|----------------|--------------------|
| PORT      | 3001           | Server port        |
| DATABASE_URL | _(required)_ | PostgreSQL URI (Supabase Session/Transaction pooler or direct) |
| DATABASE_AUTO_MIGRATE | _(unset)_ | Set to `1` to re-apply `schema.pg.sql` on startup |
| NODE_ENV  | development    | Environment (development / production) |
| SEED_PATH | data/eventPool.json | Used by `npm run seed` |
| EVENT_STORE_LIMIT_PER_CATEGORY | 400 | Max events **stored** per category when merging Wikidata into the pool (separate from SPARQL phase1 limits). |
| EVENT_POOL_TTL_DAYS | 30 | Per-event TTL by `created_at` (≈1 month). Ignored if `EVENT_POOL_TTL_MINUTES` is set. |
| EVENT_POOL_TTL_MINUTES | _(from days)_ | Override TTL in minutes (e.g. `43200` = 30 days). |
| EVENT_POOL_MAX_TOTAL | 10000 | Global cap after merge (by popularity). Set `0` or `unlimited` for no cap. |
| REFRESH_SECRET | _(unset)_ | If set, `POST /api/admin/refresh-events` requires header `x-refresh-secret`. |

## Running in production

Set environment variables (e.g. on Render or in `.env`):

- **PORT** — Port the server will listen on (hosting platforms often set this).
- **DATABASE_URL** — Supabase or other Postgres. The event pool and rooms persist across deploys; no disk mount is required for the DB. Use the **pooler** URI if your host recommends it (connection limits).
- **NODE_ENV** — Set to `production` in production.

First deploy: ensure schema is applied (`db:migrate`, SQL editor, or first boot with empty DB). Optional **`DATABASE_AUTO_MIGRATE=1`** only if you intentionally want startup to re-run the schema file.

Example:

```bash
npm run build
npm run start
```

The server binds to `0.0.0.0` so it accepts connections from the platform’s proxy. The `/health` endpoint returns `{ "status": "ok" }` with HTTP 200 for health checks.

## Frontend

Point the frontend at this backend:

- `NEXT_PUBLIC_API_URL=http://localhost:3001` (default in code)
- Create/join rooms from the home page; open `/room/:roomId` to play.
