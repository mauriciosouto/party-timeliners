import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { roomsRouter } from "./routes/rooms.js";
import { eventsRouter } from "./routes/events.js";
import { adminRouter } from "./routes/admin.js";
import { initDb, queryOne, queryRows, rowCount } from "./db/index.js";
import { ensureEventPool } from "./db/ensureEventPool.js";
import { attachRoomHub } from "./ws/roomHub.js";

const app = express();
const server = createServer(app);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false,
  }),
);
app.use(express.json());

app.use("/api/rooms", roomsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/admin", adminRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

async function getStatusMetrics(): Promise<{
  eventsCount: number;
  roomsTotal: number;
  roomsInLobby: number;
  roomsPlaying: number;
  roomsEnded: number;
}> {
  const eventsRow = await queryOne<{ count: unknown }>("SELECT COUNT(*)::int AS count FROM events", []);
  const eventsCount = rowCount(eventsRow, "count");
  const roomsByStatus = await queryRows<{ status: string; count: unknown }>(
    "SELECT status, COUNT(*)::int AS count FROM rooms GROUP BY status",
    [],
  );
  const map = new Map<string, number>();
  for (const row of roomsByStatus) map.set(row.status, Number(row.count) || 0);
  const roomsInLobby = map.get("lobby") ?? 0;
  const roomsPlaying = map.get("playing") ?? 0;
  const roomsEnded = map.get("ended") ?? 0;
  const roomsTotal = roomsInLobby + roomsPlaying + roomsEnded;
  return {
    eventsCount,
    roomsTotal,
    roomsInLobby,
    roomsPlaying,
    roomsEnded,
  };
}

app.get("/", async (req, res) => {
  try {
    const m = await getStatusMetrics();
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Party Timeliners — Status</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #555; margin: 0 0 1rem; }
    .status { color: #0a0; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee; }
    th { color: #666; font-weight: 500; }
    .metric { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <h1>Party Timeliners — Backend</h1>
  <p><span class="status">● Running</span></p>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Events in pool</td><td class="metric">${m.eventsCount}</td></tr>
      <tr><td>Rooms (total)</td><td class="metric">${m.roomsTotal}</td></tr>
      <tr><td>Rooms in lobby</td><td class="metric">${m.roomsInLobby}</td></tr>
      <tr><td>Active games</td><td class="metric">${m.roomsPlaying}</td></tr>
      <tr><td>Rooms ended</td><td class="metric">${m.roomsEnded}</td></tr>
    </tbody>
  </table>
</body>
</html>`;
    res.status(200).type("html").send(html);
  } catch (err) {
    console.error("Status page error:", err);
    res.status(500).type("text/plain").send("Error loading status");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  attachRoomHub(ws);
});

async function start() {
  await initDb();
  await ensureEventPool();

  console.log("Environment:", config.nodeEnv);
  console.log("Database: PostgreSQL (DATABASE_URL)");
  console.log("Server port:", config.port);

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Server running on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
