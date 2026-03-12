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

Frontend stack:

- Next.js
- React
- TypeScript
- TailwindCSS
- dnd-kit (drag and drop)

---

# Frontend Folder Structure
