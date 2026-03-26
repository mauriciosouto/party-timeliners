# Backend Architecture — Party Timeliners (Node multiplayer server)

The `backend/` package is the **Node.js** game server: Express (REST), WebSockets for rooms, and **PostgreSQL** persistence (e.g. **Supabase**). It mirrors the API shape used by the frontend; production real-time hosting may also use Cloudflare Workers + Durable Objects separately.

---

## 1. Database (PostgreSQL)

Connection string: **`DATABASE_URL`** (required). The app uses the **`pg`** pool. Schema lives in **`backend/src/db/schema.pg.sql`**.

**Apply schema**

- On first start, if `public.events` is missing, the server runs `schema.pg.sql` automatically.
- Or set **`DATABASE_AUTO_MIGRATE=1`** to re-apply (idempotent `CREATE IF NOT EXISTS`).
- Or run **`npm run db:migrate`** (same SQL file).

**Main tables**

| Table | Purpose |
|-------|---------|
| `events` | Global event pool (Wikidata ingestion, seed). |
| `event_pool_meta` | Pool metadata (e.g. last refresh). |
| `rooms` | One row per room: status, turn, deck cursor, settings. |
| `room_players` | Players in a room (nickname, score, host, connection). |
| `room_timeline` | Ordered placed events per room. |
| `room_deck` | Shuffled deck per room. |
| `room_hand` | Up to three cards per player per room. |

Room-scoped tables use **`ON DELETE CASCADE`** from `rooms`.

---

## 2. API and real-time

See **[backend/README.md](../backend/README.md)** for REST routes (`/api/rooms`, …), WebSocket protocol (`/ws`), env vars (`DATABASE_URL`, pool TTL, refresh secret), and scripts (`seed`, `refresh-events`, `db:migrate`).

---

## 3. Layered layout (approximate)

```
backend/src/
├── index.ts           # HTTP + WS server, initDb
├── config.ts          # PORT, DATABASE_URL, pool/TTL env
├── db/
│   ├── index.ts       # pg Pool, initDb, transactions, q(? → $n)
│   ├── schema.pg.sql
│   ├── ensureEventPool.ts
│   └── seed.ts
├── routes/            # rooms, events, admin
├── services/          # roomService (authoritative game logic)
└── ws/roomHub.ts      # WebSocket room hub
```

---

## 4. Scalability notes

- Use a **single** `DATABASE_URL` per deployment; **`pg`** pool is configured for one Node process. Multiple app instances are OK against the same Postgres if you are aware of connection limits (Supabase pooler vs direct).
- Event pool TTL and merges assume rows persist in Postgres (unlike ephemeral container disk).

---

## 5. Production deployment

Example: **[Render](https://render.com)** with **`DATABASE_URL`** pointing at Supabase (Session or Transaction pooler URI from the Supabase dashboard).

**Health check:** `GET /health` → `{ "status": "ok" }`.
