import { Router } from "express";
import * as roomService from "../services/roomService.js";

export const roomsRouter = Router();

roomsRouter.post("/", async (req, res) => {
  try {
    const nickname =
      (req.body?.nickname as string)?.trim() || "Player";
    const name = (req.body?.name as string)?.trim();
    const avatar = (req.body?.avatar as string)?.trim() || undefined;
    const maxTimelineSize =
      req.body?.maxTimelineSize != null ? Number(req.body.maxTimelineSize) : undefined;
    const pointsToWin =
      req.body?.pointsToWin != null ? Number(req.body.pointsToWin) : undefined;
    const turnTimeLimitSeconds =
      req.body?.turnTimeLimitSeconds != null
        ? (req.body.turnTimeLimitSeconds === null || req.body.turnTimeLimitSeconds === ""
          ? null
          : Number(req.body.turnTimeLimitSeconds))
        : undefined;
    const options =
      maxTimelineSize !== undefined ||
      pointsToWin !== undefined ||
      turnTimeLimitSeconds !== undefined ||
      avatar !== undefined
        ? { maxTimelineSize, pointsToWin, turnTimeLimitSeconds, avatar }
        : undefined;
    const result = await roomService.createRoom(nickname, name || undefined, options);
    res.status(201).json(result);
  } catch (err) {
    console.error("[POST /rooms]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to create room",
    });
  }
});

roomsRouter.get("/:id", async (req, res) => {
  const playerId = (req.query?.playerId as string)?.trim() || undefined;
  const state = await roomService.getRoomState(req.params.id, playerId);
  if (!state) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(state);
});

roomsRouter.post("/:id/join", async (req, res) => {
  const nickname =
    (req.body?.nickname as string)?.trim() || "Player";
  const email = (req.body?.email as string)?.trim() || undefined;
  const avatar = (req.body?.avatar as string)?.trim() || undefined;
  const result = await roomService.joinRoom(req.params.id, nickname, email, avatar);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(200).json(result);
});

roomsRouter.post("/:id/start", async (req, res) => {
  const playerId = (req.body?.playerId as string)?.trim();
  if (!playerId) {
    res.status(400).json({ error: "playerId required" });
    return;
  }
  const result = await roomService.startGame(req.params.id, playerId);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

roomsRouter.get("/:id/next-event", async (req, res) => {
  const playerId = (req.query?.playerId as string)?.trim();
  if (!playerId) {
    res.status(400).json({ error: "playerId required" });
    return;
  }
  const event = await roomService.getNextEventForCurrentTurn(
    req.params.id,
    playerId,
  );
  if (!event) {
    res.status(404).json({ error: "No next event or not your turn" });
    return;
  }
  res.json({ event });
});

roomsRouter.post("/:id/place", async (req, res) => {
  const { eventId, position, playerId } = req.body;

  if (
    typeof playerId !== "string" ||
    typeof eventId !== "string" ||
    typeof position !== "number" ||
    position < 0 ||
    !Number.isInteger(position)
  ) {
    res.status(400).json({
      error:
        "Invalid body: require playerId (string), eventId (string), position (non-negative integer)",
    });
    return;
  }

  const result = await roomService.placeEvent(
    req.params.id,
    playerId,
    eventId,
    position,
  );
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

roomsRouter.post("/:id/turn-timeout", async (req, res) => {
  const playerId = (req.body?.playerId as string)?.trim();
  if (!playerId) {
    res.status(400).json({ error: "playerId required" });
    return;
  }
  const result = await roomService.timeoutTurn(req.params.id, playerId);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

roomsRouter.post("/:id/leave", async (req, res) => {
  const playerId = (req.body?.playerId as string)?.trim();
  if (!playerId) {
    res.status(400).json({ error: "playerId required" });
    return;
  }
  const result = await roomService.leaveRoom(req.params.id, playerId);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});
