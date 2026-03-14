# Party Timeliners — Backend

Node.js + Express API, WebSocket server, and SQLite persistence for the **multiplayer** timeline card game.

## Setup

```bash
cd backend
npm install
```

## Database and seed

1. Create the events pool (one-time). Copy the frontend pool or set `SEED_PATH`:

   ```bash
   mkdir -p data
   cp ../frontend/data/eventPool.json data/
   ```

2. Seed the database:

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

Tests use [Vitest](https://vitest.dev/). They include **unit tests** (pure logic, no DB) and **integration tests** (room service with SQLite).

**Run all tests:**

```bash
npm run test
```

**Run tests with coverage** (V8; incluye tests unitarios e **integración**; salida en terminal + HTML en `coverage/`):

```bash
npm run test:coverage
```

El reporte de coverage se genera con **todos** los tests (unit + integración). Los tests de integración aportan cobertura a `roomService.ts`, `db/index.ts`, etc.

Opcional: solo tests de integración con coverage:

```bash
npx vitest run --coverage src/**/*.integration.test.ts
```

**Watch mode** (re-run on file changes):

```bash
npm run test:watch
```

**What’s covered:**

| Area | Path | Description |
|------|------|-------------|
| Event quality | `src/game/eventQuality.test.ts` | `isGoodEvent`, `filterGoodEvents` (title/year/image/wikipedia rules) |
| Timeline | `src/game/timeline.test.ts` | `isValidPosition`, `findCorrectPosition`, `isCorrectPlacement` |
| Validation | `src/game/validation.test.ts` | `validatePlace`, `getNextTurnPlayerId` |
| Deck | `src/game/deck.test.ts` | `shuffle`, `buildDeck` (excludeIds, quality preference) |
| Event ingestion | `src/services/eventIngestion.test.ts` | `mergeWithExistingPool` (cumulative pool, limit per category) |
| Room service (integration) | `src/services/roomService.integration.test.ts` | createRoom, joinRoom, startGame, placeEvent, endGame, rematchRoom with real DB |

Integration tests use a separate DB file (`test-data/integration.db`, see `vitest.config.ts`). They seed the `events` table with sample data and clear room tables between tests.

## Env

| Variable   | Default        | Description        |
|-----------|----------------|--------------------|
| PORT      | 3001           | Server port        |
| DB_PATH   | data/game.db   | SQLite file path   |
| SEED_PATH | data/eventPool.json | Used by `npm run seed` |

## Frontend

Point the frontend at this backend:

- `NEXT_PUBLIC_API_URL=http://localhost:3001` (default in code)
- Create/join rooms from the home page; open `/room/:roomId` to play.
