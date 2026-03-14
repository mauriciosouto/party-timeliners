# Party Timeliners

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A casual multiplayer browser game where players place historical events in chronological order on a shared timeline. Simple to learn, fast to play, no account required—just share a link and play with friends.

---

## Table of Contents

- [Play the Game](#play-the-game)
- [Gameplay Preview](#gameplay-preview)
- [Why this project exists](#why-this-project-exists)
- [How the game works](#how-the-game-works)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Play the Game

<!-- TODO: Add link when the game is deployed -->

**[Play Party Timeliners online](https://example.com)** *(coming soon)*

Until then, run the game locally—see [Development](#development).

---

## Gameplay Preview

![Party Timeliners gameplay](docs/gameplay.gif)

*Add a short recording of the game (lobby, timeline, or drag-and-drop) and save it as `docs/gameplay.gif`.*

---

## Why this project exists

Party Timeliners is a **simple multiplayer timeline party game** you can play directly in the browser. No app install, no accounts—someone creates a room, shares the link, and everyone joins with a nickname. The idea is to keep the barrier to entry low so that a group can start playing in seconds: place historical events in the right order on a shared timeline, take turns, and score points. The project aims to be easy to run and contribute to, with a clear path from local dev to a low-cost, scalable deployment (e.g. Cloudflare Workers + Durable Objects).

---

## How the game works

Party Timeliners is played in the browser. Players join a room via a shared link, enter a nickname (no account or email required), and take turns placing **hidden** historical event cards onto a shared timeline. After each placement, the year is revealed and the game scores the move. The timeline stays in chronological order; the goal is to guess where each event belongs.

**Reconnection:** If a player closes the tab or browser, they can rejoin the same room from the same device: credentials are stored in `localStorage`. When they return to the site, the home page checks whether their last room is still active; if so, they see the option to **rejoin** or **clear that session** and start a new game. No automatic redirect—they choose.

**Design goals:**

- Simple party game with minimal setup
- Fast rounds, low barrier to entry
- Real-time multiplayer over WebSockets
- No sign-up; join with a link
- Low infrastructure cost (targeting serverless/edge)

### Gameplay rules

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

## Architecture

### Overview

- **Browser client** — Next.js app that renders the UI, keeps local state, and sends actions over HTTP and WebSocket. It does not enforce game rules; all authoritative logic runs on the server.
- **WebSockets** — Real-time channel for joining rooms, receiving room state, placing events, and turn/timeout updates.
- **Cloudflare Workers** — (Production target.) Game router that receives HTTP and WebSocket traffic and forwards to the correct room.
- **Durable Objects** — (Production target.) One Durable Object per game room; holds room state, timeline, scores, turn order, and pushes updates to connected clients.
- **External APIs** — Historical events are sourced from [Wikidata](https://www.wikidata.org/) and [Wikipedia](https://www.wikipedia.org/). The event pool and refresh live on the backend (`npm run refresh-events` or `POST /api/admin/refresh-events`); the frontend keeps a small example pool for fallback when the backend is unavailable.

### Diagram

```
  Browser clients
         │
         │ HTTP / WebSocket
         ▼
  Cloudflare Workers (game router)
         │
         ▼
  Durable Objects (one per room: state, timeline, WebSockets)
         │
         ▼
  External APIs (Wikidata / Wikipedia)
```

### Tech stack

| Layer   | Technologies |
|--------|---------------|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, [dnd-kit](https://dndkit.com/) (drag and drop) |
| Backend  | Cloudflare Workers, Durable Objects, WebSockets (real-time multiplayer) |
| Data     | Wikidata, Wikipedia (historical events) |

### Project structure

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

## Development

### Prerequisites

Node.js (v18+), npm (or yarn/pnpm).

### Local setup

1. **Clone and install**

   ```bash
   git clone https://github.com/your-org/party-timeliners.git
   cd party-timeliners
   npm install --prefix frontend
   npm install --prefix backend
   ```

2. **Backend** — The repo includes a Node.js server (Express + WebSockets + SQLite) that matches the Cloudflare Workers API contract. See [Running the backend](#running-the-backend).

3. **Frontend** — Uses the local backend by default (`NEXT_PUBLIC_API_URL=http://localhost:3001`). See [Running the frontend](#running-the-frontend).

4. **Environment** — Optional: create `backend/.env` or set `PORT`, `DB_PATH`, `SEED_PATH`. No `.env` is required for a basic run after seeding.

### Running the frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). From the home page you can create a room, join with a link, or—if you have a previous session and the room is still active—rejoin or clear that session. Gameplay is at `/room/[roomId]`.

- **Build:** `npm run build`
- **Start (production):** `npm run start`

### Running the backend

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

**Scripts:**

- `npm run seed` — Seed the database from the event pool.
- `npm run refresh-events` — Refresh the event pool (e.g. from Wikidata). See `backend/README.md` for API and env details.

### Testing

The backend includes **unit tests** and **integration tests** ([Vitest](https://vitest.dev/)).

| Comando | Descripción |
|--------|-------------|
| `cd backend && npm run test` | Ejecuta todos los tests (unit + integración). |
| `cd backend && npm run test:coverage` | Igual + reporte de coverage en terminal y en `backend/coverage/` (HTML + lcov). |
| `cd backend && npm run test:watch` | Modo watch: vuelve a correr tests al guardar. |

**Qué se prueba**

- **Unit:** lógica de juego (event quality, timeline, validación de jugada, deck), merge del pool de eventos.
- **Integración:** sala, unirse, iniciar partida, colocar evento, terminar partida, revancha (con SQLite real).

**Coverage en GitHub**

En cada push y en cada PR, [GitHub Actions](.github/workflows/test.yml) ejecuta los tests con coverage:

1. **Resultado del job** — En la pestaña *Actions* ves si los tests pasan o fallan.
2. **Descargar reporte** — En cada run podés bajar el artifact *coverage-report* (carpeta `coverage/`); al descomprimir, abrí `index.html` en el navegador para ver el reporte completo.
3. **Badge y resumen en PRs (opcional)** — Si conectás el repo con [Codecov](https://codecov.io) y añadís `CODECOV_TOKEN` en los secrets del repo, el workflow sube el coverage y podés usar un badge en el README y ver el diff de coverage en cada PR.

Ver [backend/README.md](backend/README.md#testing) para más detalle y scripts opcionales.

### Deployment

- **Frontend** — Deploy to Vercel, Netlify, or any host that supports Next.js. Set `NEXT_PUBLIC_API_URL` to your game API URL.
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
