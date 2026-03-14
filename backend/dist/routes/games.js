import { Router } from "express";
import * as gameService from "../services/gameService.js";
export const gamesRouter = Router();
gamesRouter.post("/", (req, res) => {
    try {
        const result = gameService.createGame();
        res.status(201).json(result);
    }
    catch (err) {
        console.error("[POST /games]", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Failed to create game",
        });
    }
});
gamesRouter.get("/:id", (req, res) => {
    const state = gameService.getGameState(req.params.id);
    if (!state) {
        res.status(404).json({ error: "Game not found" });
        return;
    }
    res.json(state);
});
gamesRouter.get("/:id/next-event", (req, res) => {
    const event = gameService.getNextEvent(req.params.id);
    if (!event) {
        res.status(404).json({ error: "No next event or game ended" });
        return;
    }
    res.json({ event });
});
gamesRouter.post("/:id/place", (req, res) => {
    const { eventId, position } = req.body;
    if (typeof eventId !== "string" ||
        typeof position !== "number" ||
        position < 0 ||
        !Number.isInteger(position)) {
        res.status(400).json({
            error: "Invalid body: require eventId (string) and position (non-negative integer)",
        });
        return;
    }
    const result = gameService.placeEvent(req.params.id, eventId, position);
    if (!result) {
        res.status(404).json({ error: "Game or event not found" });
        return;
    }
    res.json(result);
});
