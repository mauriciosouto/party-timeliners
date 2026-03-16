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

# Frontend Architecture

The frontend is responsible for:

- rendering the game UI
- managing local player state
- sending actions to the server
- receiving real-time updates

The frontend **does not validate gameplay rules**.  
All authoritative game logic lives on the server.

**Event pool:** Obtaining events (Wikidata), seeding, storing the pool, and refreshing it are done on the server. Events are stored in the database (`events` table). The pool has a configurable TTL: when the server starts, if the pool is empty or older than the TTL, it is replaced (from JSON or Wikidata). Set `EVENT_POOL_TTL_MINUTES` (default 15 for testing; use 1440 for 24h). The backend exposes `GET /api/events/next` (single-player) and builds room decks from the DB when a game starts. To refresh manually: `npm run refresh-events` or `POST /api/admin/refresh-events` (optional `x-refresh-secret` header).

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
│   ├── EventCard.tsx         # Draggable/reveal card, event image and year
│   ├── GameBoard.tsx         # Single-player game (optional)
│   ├── JoinForm.tsx          # Join room by ID/link
│   ├── Lobby.tsx             # Pre-game: players list, start game, join sound
│   ├── RoomGameBoard.tsx     # Multiplayer: timeline, turn timer, results, errors
│   └── Timeline.tsx          # Horizontal timeline + droppable slots
├── lib/
│   ├── eventPool.ts
│   ├── eventTypeStyles.ts
│   ├── format.ts
│   ├── imageUtils.ts
│   ├── roomStorage.ts
│   ├── types.ts
│   └── ...
└── src/
    ├── hooks/
    │   └── useRoomSocket.ts  # WebSocket, room state, place/start/rematch
    ├── services/
    │   ├── EventService.ts
    │   └── roomApi.ts
    └── utils/
        ├── confetti.ts       # fireSuccessConfetti (correct place)
        ├── victoryConfetti.ts
        ├── sound.ts          # playSound, stopTickSound, playJoinSound, playStartGameSound
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

---

# Testing

- **Backend:** Vitest (`backend npm run test`). Tests cover game logic (timeline, validation, deck, event quality), event ingestion, and room service integration. No changes to gameplay or sync logic were made in the UI work; these tests remain valid.
- **Frontend:** Vitest (`frontend npm run test`). Currently covers utility modules (e.g. `src/utils/sound.test.ts`: exports and no-throw behavior when `Audio` is unavailable in Node). UI/components are not yet under unit tests.
