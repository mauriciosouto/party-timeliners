import * as roomService from "../services/roomService.js";
const clientsByRoom = new Map();
function getRoomClients(roomId) {
    let set = clientsByRoom.get(roomId);
    if (!set) {
        set = new Set();
        clientsByRoom.set(roomId, set);
    }
    return set;
}
function broadcastRoomState(roomId) {
    const state = roomService.getRoomState(roomId);
    if (!state)
        return;
    const payload = JSON.stringify({ type: "room_state", roomState: state });
    getRoomClients(roomId).forEach((c) => {
        if (c.ws.readyState === 1)
            c.ws.send(payload);
    });
}
export function attachRoomHub(ws) {
    let client = null;
    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "join_room") {
                const { roomId, playerId, nickname, email } = msg;
                if (!roomId || !nickname) {
                    ws.send(JSON.stringify({
                        type: "join_error",
                        code: "invalid",
                        message: "roomId and nickname required",
                    }));
                    return;
                }
                const existing = roomService.getRoomState(roomId);
                if (!existing) {
                    ws.send(JSON.stringify({
                        type: "join_error",
                        code: "not_found",
                        message: "Room not found",
                    }));
                    return;
                }
                let joinedPlayerId;
                if (playerId && existing.players.some((p) => p.playerId === playerId)) {
                    joinedPlayerId = playerId;
                    roomService.setPlayerConnected(roomId, playerId, true);
                }
                else if (existing.status !== "lobby") {
                    ws.send(JSON.stringify({
                        type: "join_error",
                        code: "started",
                        message: "Game already started",
                    }));
                    return;
                }
                else {
                    const result = roomService.joinRoom(roomId, nickname, email ?? undefined);
                    if ("error" in result) {
                        ws.send(JSON.stringify({
                            type: "join_error",
                            code: "join_failed",
                            message: result.error,
                        }));
                        return;
                    }
                    joinedPlayerId = result.playerId;
                }
                client = { ws, playerId: joinedPlayerId, roomId };
                getRoomClients(roomId).add(client);
                const state = roomService.getRoomState(roomId);
                ws.send(JSON.stringify({
                    type: "join_ack",
                    playerId: joinedPlayerId,
                    roomState: state,
                }));
                broadcastRoomState(roomId);
                return;
            }
            if (!client) {
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Send join_room first",
                }));
                return;
            }
            if (msg.type === "start_game") {
                const result = roomService.startGame(client.roomId, client.playerId);
                if ("error" in result) {
                    ws.send(JSON.stringify({
                        type: "start_error",
                        code: "failed",
                        message: result.error,
                    }));
                    return;
                }
                broadcastRoomState(client.roomId);
                return;
            }
            if (msg.type === "place_event") {
                const { eventId, position } = msg;
                if (typeof eventId !== "string" || typeof position !== "number") {
                    ws.send(JSON.stringify({
                        type: "place_error",
                        code: "invalid",
                        message: "eventId and position required",
                    }));
                    return;
                }
                const result = roomService.placeEvent(client.roomId, client.playerId, eventId, position);
                if ("error" in result) {
                    ws.send(JSON.stringify({
                        type: "place_error",
                        code: "failed",
                        message: result.error,
                    }));
                    return;
                }
                ws.send(JSON.stringify({ type: "place_result", ...result }));
                broadcastRoomState(client.roomId);
                return;
            }
            if (msg.type === "turn_timeout") {
                const result = roomService.timeoutTurn(client.roomId, client.playerId);
                if ("error" in result) {
                    ws.send(JSON.stringify({
                        type: "place_error",
                        code: "timeout_failed",
                        message: result.error,
                    }));
                    return;
                }
                const state = roomService.getRoomState(client.roomId);
                ws.send(JSON.stringify({
                    type: "place_result",
                    correct: false,
                    score: state?.scores[client.playerId] ?? 0,
                    timeline: result.timeline ?? state?.timeline ?? [],
                    nextEvent: result.nextEvent ?? null,
                    nextTurnPlayerId: result.nextTurnPlayerId,
                    gameEnded: result.gameEnded,
                }));
                broadcastRoomState(client.roomId);
                return;
            }
            if (msg.type === "end_game") {
                const result = roomService.endGame(client.roomId, client.playerId);
                if ("error" in result) {
                    ws.send(JSON.stringify({
                        type: "end_game_error",
                        code: "failed",
                        message: result.error,
                    }));
                    return;
                }
                broadcastRoomState(client.roomId);
                return;
            }
            if (msg.type === "rematch") {
                const result = roomService.rematchRoom(client.roomId, client.playerId);
                if ("error" in result) {
                    ws.send(JSON.stringify({
                        type: "rematch_error",
                        code: "failed",
                        message: result.error,
                    }));
                    return;
                }
                broadcastRoomState(client.roomId);
                return;
            }
            if (msg.type === "ping") {
                ws.send(JSON.stringify({ type: "pong" }));
                return;
            }
        }
        catch (e) {
            ws.send(JSON.stringify({
                type: "error",
                message: e instanceof Error ? e.message : "Invalid message",
            }));
        }
    });
    ws.on("close", () => {
        if (client) {
            roomService.setPlayerConnected(client.roomId, client.playerId, false);
            getRoomClients(client.roomId).delete(client);
            broadcastRoomState(client.roomId);
        }
    });
}
