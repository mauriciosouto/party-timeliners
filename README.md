# Party Timeliners

A casual multiplayer browser game where players place historical events in chronological order on a shared timeline. Simple to learn, fast to play, no account required—just share a link and play with friends.

---

## Screenshot

<!-- TODO: Add gameplay screenshot -->

*Screenshot placeholder. Add a capture of the game room or timeline view.*

---

## Game overview

Party Timeliners is played in the browser. Players join a room via a shared link, enter a nickname (no account or email required), and take turns placing **hidden** historical event cards onto a shared timeline. After each placement, the year is revealed and the game scores the move. The timeline stays in chronological order; the goal is to guess where each event belongs.

**Reconnection:** If a player closes the tab or browser, they can rejoin the same room from the same device: credentials are stored in `localStorage`. When they return to the site, the home page checks whether their last room is still active; if so, they see the option to **rejoin** or **clear that session** and start a new game. No automatic redirect—they choose.

**Design goals:**

- Simple party game with minimal setup
- Fast rounds, low barrier to entry
- Real-time multiplayer over WebSockets
- No sign-up; join with a link
- Low infrastructure cost (targeting serverless/edge)

---

## Gameplay rules

1. **Lobby** — Players join with a link, set a nickname, and wait in the lobby. The host can configure room name, points to win, turn time limit, and max timeline size. The host starts the game when ready (minimum 1 player).

2. **Timeline** — The timeline starts with one revealed event. Events are shown as cards with title, description, and optional image. The year is hidden until after placement.

3. **Turns** — On your turn you receive a hidden event card. Drag it into the correct position between existing events. After you place it:
   - **Correct** → You score 1 point; the event stays in place.
   - **Incorrect** → The correct position is revealed; you score 0.

4. **Same year** — Events in the same year are treated as interchangeable for ordering.

5. **Game end** — The game ends when the timeline reaches the configured max size or the event pool is exhausted. Highest score wins. Players can then rematch from the lobby.

6. **Disconnections** — If a player drops during their turn, the turn is skipped. Players can reconnect from the same browser: the app stores room credentials in `localStorage`, so reopening the room link or using “Volver a sumarse” on the home page (if the room is still active) restores their session. No email required.

7. **Returning to the site** — On the home page, if the backend reports that the last stored room is still active, the player sees: **Volver a sumarse** (rejoin), **Terminar partida anterior** (clear stored session and stay on home), or the usual create/join forms. If the room no longer exists, the stored session is cleared automatically.

---

## Tech stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | Next.js, React, TypeScript, Tailwind CSS, [dnd-kit](https://dndkit.com/) (drag and drop) |
| **Backend** | Cloudflare Workers, Durable Objects, WebSockets (real-time multiplayer) |
| **Data** | Wikidata, Wikipedia (historical events) |

---

## Architecture overview

```
Browser clients
       │
       │ WebSocket / HTTP
       ▼
Cloudflare Workers (game router)
       │
       ▼
Durable Objects (one per game room)
       │
       ▼
External APIs (Wikidata / Wikipedia)
```

- **Frontend** — Renders the UI, manages local state, sends actions to the server. It does not enforce game rules; all authoritative logic runs on the server.
- **Workers** — Route requests and WebSocket connections to the correct Durable Object (room).
- **Durable Objects** — Each game room is an isolated Durable Object holding room state, timeline, scores, and turn order. WebSockets provide real-time updates to all players in the room.
- **Events** — Historical events are sourced from Wikidata/Wikipedia; the system avoids storing a full local history. Events include id, title, year, description, optional image, and link. The event pool and refresh live on the backend only (`npm run refresh-events` or `POST /api/admin/refresh-events`); the frontend keeps a small example pool for fallback when the backend is unavailable.

---

## Project structure

```
party-timeliners/
├── frontend/          # Next.js app (UI, drag-and-drop timeline, room pages)
│   ├── app/           # App Router routes (/, /room/[roomId])
│   ├── components/    # React components (JoinForm, Lobby, RoomGameBoard)
│   ├── lib/           # Utilities (event pool fallback, roomStorage for reconnection)
│   └── src/           # Hooks, services (API, WebSocket)
├── backend/           # Node.js game server (local dev; mirrors Workers API)
│   ├── src/
│   │   ├── db/        # SQLite schema, seed, event pool
│   │   ├── routes/    # REST (rooms, admin, events)
│   │   ├── services/  # Game and room logic
│   │   └── ws/        # WebSocket room hub
│   └── scripts/       # e.g. refresh-events from Wikidata
├── shared/            # Shared types (if any)
└── docs/              # Architecture, multiplayer design, project context
```

---

## Local development setup

**Prerequisites:** Node.js (v18+), npm (or yarn/pnpm).

1. **Clone and install**

   ```bash
   git clone https://github.com/your-org/party-timeliners.git
   cd party-timeliners
   npm install --prefix frontend
   npm install --prefix backend
   ```

2. **Backend (game server)** — For local development, the repo includes a Node.js server (Express + WebSockets + SQLite) that implements the same API and WebSocket contract as the Cloudflare Workers target. See [Running the backend](#running-the-backend).

3. **Frontend** — Points at the local backend by default (`NEXT_PUBLIC_API_URL=http://localhost:3001`). See [Running the frontend](#running-the-frontend).

4. **Environment** — Optional: create `backend/.env` or set `PORT`, `DB_PATH`, `SEED_PATH` if you need to override defaults. No `.env` is required for a basic run after seeding.

---

## Running the frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). From the home page you can create a room, join with a link, or—if you have a previous session and the room is still active—rejoin or clear that session. Gameplay is at `/room/[roomId]`.

- **Build:** `npm run build`
- **Start (production):** `npm run start`

---

## Running the backend

The `backend/` app is the **local development** game server (Node.js + Express + WebSockets + SQLite). Production deployment uses **Cloudflare Workers** and **Durable Objects**.

**First-time setup:**

```bash
cd backend
npm install
mkdir -p data
# Optional: copy event pool JSON or set SEED_PATH
npm run seed    # Populates events table; required before starting games
```

**Run:**

```bash
# Development (watch mode)
npm run dev

# Production
npm run build && npm start
```

Server: `http://localhost:3001` (or `PORT`). WebSocket: `ws://localhost:3001/ws`.

**Useful scripts:**

- `npm run seed` — Seed the database from the event pool.
- `npm run refresh-events` — Refresh the event pool (e.g. from Wikidata). See `backend/README.md` for API and env details.

---

## Deployment overview

- **Frontend** — Can be deployed to Vercel, Netlify, or any static/Node host that supports Next.js. Set `NEXT_PUBLIC_API_URL` to your game API URL.
- **Backend (production)** — Target architecture is **Cloudflare Workers** plus **Durable Objects**: one Worker as the game router and one Durable Object per game room for state and WebSockets. The Node.js backend in this repo is the reference implementation for local development and for the API/WebSocket contract.

Deployment steps for Workers/Durable Objects will be documented in the repo (e.g. in `docs/` or a dedicated `DEPLOY.md`) when the Workers implementation is added.

---

## Contributing

Contributions are welcome. To contribute:

1. Open an issue to discuss larger changes or new features.
2. Fork the repo, create a branch, and make your changes.
3. Ensure the frontend and backend run locally and that existing behavior is preserved.
4. Submit a pull request with a short description of the change.

Please keep the game simple, fast, and accessible; avoid adding account requirements or heavy dependencies unless discussed first.

---

## License

This project is licensed under the [MIT License](LICENSE).

Historical event data used in the game may be sourced from external projects, including [Wikidata](https://www.wikidata.org/) (CC0) and [Wikipedia](https://www.wikipedia.org/) (Creative Commons Attribution-ShareAlike). Those materials are subject to their respective licenses.
