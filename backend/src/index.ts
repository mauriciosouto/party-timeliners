import dotenv from "dotenv";
dotenv.config();

import path from "node:path";
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

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  attachRoomHub(ws);
});

const resolvedDbPath =
  config.dbPath && path.isAbsolute(config.dbPath)
    ? config.dbPath
    : path.resolve(process.cwd(), config.dbPath);

async function start() {
  await initDb();
  await ensureEventPool();

  console.log("Environment:", config.nodeEnv);
  console.log("Database path:", resolvedDbPath);
  console.log("Server port:", config.port);

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Server running on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
