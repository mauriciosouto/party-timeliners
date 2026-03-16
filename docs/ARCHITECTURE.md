# Party Timeliners — System Architecture

This document defines the technical architecture of the Party Timeliners project.

The goal of this architecture is to keep the system:

- simple
- scalable
- low-cost
- easy to maintain
- easy for AI-assisted development

The project is divided into three major parts:

1. Frontend application
2. Multiplayer game server
3. External event data providers

---

# High Level Architecture

System overview:

Browser Clients
      │
      │ WebSocket
      ▼
Cloudflare Workers
(Game Router)
      │
      ▼
Durable Objects
(Game Rooms)
      │
      ▼
External APIs
(Wikidata / Wikipedia)

---

# Production Hosting Architecture

The deployed system uses the following hosting:

```
Client (Browser)
      │
      │ HTTPS / WSS
      ▼
Frontend (Next.js on Vercel)
      │
      │ REST + WebSocket
      ▼
Backend API + WebSocket (Node.js on Render)
      │
      ▼
SQLite event database
```

- **Frontend (Vercel):** Serves the Next.js app. Users open the app in the browser and create/join rooms from the home page.
- **Backend (Render):** Single Node.js process running Express (REST) and a WebSocket server. Handles room creation, game state, event pool, and real-time updates.
- **Communication:** The frontend uses **REST** for room creation and event data, and **WebSocket** connections for multiplayer game state (joining rooms, state updates, placing events, turn and timeout handling).

---

# Frontend Architecture

The frontend is responsible for:

- rendering the game UI
- managing local player state
- sending actions to the server
- receiving real-time updates

The frontend **does not validate gameplay rules**.  
All authoritative game logic lives on the server.

**Event pool:** Obtaining events (Wikidata), seeding, storing the pool, and refreshing it are done on the server. Events are stored in the database (`events` table). The pool has a configurable TTL: when the server starts, if the pool is empty or older than the TTL, it is replaced (from JSON or Wikidata). Set `EVENT_POOL_TTL_MINUTES` (default 43200 = 1 month). Per-event TTL: events with `refreshed_at` older than this are pruned on each refresh; new ingestion refills so only the oldest events are lost over time. The backend exposes `GET /api/events/next` (single-player) and builds room decks from the DB when a game starts. To refresh manually: `npm run refresh-events` or `POST /api/admin/refresh-events` (optional `x-refresh-secret` header).

Frontend stack:

- Next.js
- React
- TypeScript
- TailwindCSS
- dnd-kit (drag and drop)
- canvas-confetti (success/victory effects)

---

# Frontend Folder Structure

```
frontend/
├── app/
│   ├── globals.css          # Global styles, hero/glass/timer/toast/result screen
│   ├── layout.tsx
│   ├── page.tsx             # Home (create/join room)
│   └── room/[roomId]/page.tsx  # Room: JoinForm | Lobby | RoomGameBoard
├── components/
│   ├── AvatarPicker.tsx     # Avatar grid for create/join
│   ├── EventCard.tsx        # Draggable/reveal card, event image and year
│   ├── GameBoard.tsx        # Single-player game (optional)
│   ├── JoinForm.tsx         # Join room by ID/link + avatar
│   ├── Lobby.tsx            # Pre-game: players list, Start game / Close room (host), Leave room (non-host), join sound
│   ├── RoomGameBoard.tsx    # Multiplayer: timeline, turn timer, results, Leave game (non-host), errors
│   └── Timeline.tsx         # Horizontal timeline + droppable slots
├── lib/
│   ├── avatars.ts           # AVAILABLE_AVATARS list (public/avatars/)
│   ├── eventPool.ts
│   ├── eventTypeStyles.ts
│   ├── format.ts
│   ├── imageUtils.ts
│   ├── roomStorage.ts
│   ├── types.ts
│   └── ...
└── src/
    ├── hooks/
    │   └── useRoomSocket.ts  # WebSocket: join, state_update, place/start/rematch/leave_room, leave_ack, player_left, close_room, room_closed
    ├── services/
    │   ├── EventService.ts
    │   └── roomApi.ts
    └── utils/
        ├── confetti.ts       # fireSuccessConfetti (correct place)
        ├── victoryConfetti.ts
        ├── sound.ts         # playSound, stopTickSound, playJoinSound, playStartGameSound
        └── ...
```

---

# Frontend UI and Feedback

The UI provides consistent feedback without changing game or sync logic:

- **Backgrounds:** Hero background (image + overlay) on Home, Lobby, Join; blurred background + overlay in game room.
- **Panels:** Glass-style panels (backdrop blur, light shadow) on Lobby and Join; white cards for timeline and results.
- **Results screen:** When the game ends, a horizontal results layout shows winner card (or podium), ranking list, and Play again / End game. Winner gets confetti + victory sound; losers get defeat sound + brief overlay.
- **Sounds:** Correct/wrong placement, victory/defeat, turn-timer tick (last 3 s, stops when turn ends), player join, game start. All under `frontend/public/sounds/` (see README there).
- **Timer:** Turn timer shows remaining seconds and a progress bar; colors shift from green to red as time runs out; pulse and tick sound in the last seconds.
- **Errors:** Place and room errors appear as top-center toasts and auto-dismiss after a few seconds.
- **Drag feedback:** Timeline glows while dragging; target slot is highlighted; card scales and shadows while dragging; card has a short “settle” animation on correct place.
- **Game start:** When the room goes from lobby to playing, a short sound plays and a brief full-screen flash animates.
- **Leave room:** Non-host can leave from the lobby (“Leave room” button) or during the game (“Leave game” in the header). On leave they receive `leave_ack` and are redirected home; storage for that room is cleared. Other players receive `state_update` and a `player_left` message (nickname) and see a toast “X left the game” (auto-dismiss and dismiss button).
- **Avatars:** Players choose an avatar when creating or joining a room (AvatarPicker). Avatars are stored in room_players and shown in lobby, turn indicator, and results.

---

# Testing

- **Backend:** Vitest (`backend npm run test`). Tests cover game logic (timeline, validation, deck, event quality), event ingestion, and room service integration. Room service tests include: create/join (with avatars), start/place/end/rematch, **leaveRoom** (lobby: player removed; host cannot leave; during game: non-host leaves, turn advances if it was their turn; room resets to lobby when &lt; 2 players remain), and **closeRoomPermanently** (host closes from lobby or when ended: room deleted, getRoomState returns null; non-host cannot close; room not found).
- **Frontend:** Vitest (`frontend npm run test`). Currently covers utility modules (e.g. `src/utils/sound.test.ts`: exports and no-throw behavior when `Audio` is unavailable in Node). UI/components are not yet under unit tests.
