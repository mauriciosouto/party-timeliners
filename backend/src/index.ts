import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { roomsRouter } from "./routes/rooms.js";
import { eventsRouter } from "./routes/events.js";
import { adminRouter } from "./routes/admin.js";
import { initDb } from "./db/index.js";
import { ensureEventPool } from "./db/ensureEventPool.js";
import { attachRoomHub } from "./ws/roomHub.js";

const app = express();
const server = createServer(app);

app.use(cors({ origin: true }));
app.use(express.json());

app.use("/api/rooms", roomsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/admin", adminRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  attachRoomHub(ws);
});

async function start() {
  await initDb();
  await ensureEventPool();
  server.listen(config.port, () => {
    console.log(
      `Server listening on http://localhost:${config.port} (WS: ws://localhost:${config.port}/ws)`,
    );
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
