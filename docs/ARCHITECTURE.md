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

---

# Frontend Folder Structure
