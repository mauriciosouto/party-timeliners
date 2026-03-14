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
