import type { WebSocket } from "ws";
import * as roomService from "../services/roomService.js";

type Client = { ws: WebSocket; playerId: string; roomId: string };

const clientsByRoom = new Map<string, Set<Client>>();

function getRoomClients(roomId: string): Set<Client> {
  let set = clientsByRoom.get(roomId);
  if (!set) {
    set = new Set();
    clientsByRoom.set(roomId, set);
  }
  return set;
}

function broadcastRoomState(roomId: string): void {
  const state = roomService.getRoomState(roomId);
  if (!state) {
    console.log("[roomHub] broadcastRoomState: no state for room", roomId);
    return;
  }
  const clientCount = getRoomClients(roomId).size;
  console.log("[roomHub] broadcastRoomState", {
    roomId,
    clientCount,
    status: state.status,
    currentTurnPlayerId: state.currentTurnPlayerId,
  });
  const payload = JSON.stringify({ type: "room_state", roomState: state });
  getRoomClients(roomId).forEach((c) => {
    if (c.ws.readyState === 1) c.ws.send(payload);
  });
}

export function attachRoomHub(ws: WebSocket): void {
  let client: Client | null = null;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type: string;
        roomId?: string;
        playerId?: string;
        nickname?: string;
        email?: string;
        eventId?: string;
        position?: number;
      };

      if (msg.type === "join_room") {
        const { roomId, playerId, nickname, email } = msg;
        if (!roomId || !nickname) {
          ws.send(
            JSON.stringify({
              type: "join_error",
              code: "invalid",
              message: "roomId and nickname required",
            }),
          );
          return;
        }
        const existing = roomService.getRoomState(roomId);
        if (!existing) {
          ws.send(
            JSON.stringify({
              type: "join_error",
              code: "not_found",
              message: "Room not found",
            }),
          );
          return;
        }
        let joinedPlayerId: string;
        if (playerId && existing.players.some((p) => p.playerId === playerId)) {
          joinedPlayerId = playerId;
          roomService.setPlayerConnected(roomId, playerId, true);
        } else if (existing.status !== "lobby") {
          ws.send(
            JSON.stringify({
              type: "join_error",
              code: "started",
              message: "Game already started",
            }),
          );
          return;
        } else {
          const result = roomService.joinRoom(
            roomId,
            nickname,
            email ?? undefined,
          );
          if ("error" in result) {
            ws.send(
              JSON.stringify({
                type: "join_error",
                code: "join_failed",
                message: result.error,
              }),
            );
            return;
          }
          joinedPlayerId = result.playerId;
        }
        client = { ws, playerId: joinedPlayerId, roomId };
        getRoomClients(roomId).add(client);
        const state = roomService.getRoomState(roomId)!;
        ws.send(
          JSON.stringify({
            type: "join_ack",
            playerId: joinedPlayerId,
            roomState: state,
          }),
        );
        broadcastRoomState(roomId);
        return;
      }

      if (!client) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Send join_room first",
          }),
        );
        return;
      }

      if (msg.type === "start_game") {
        const result = roomService.startGame(client.roomId, client.playerId);
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "start_error",
              code: "failed",
              message: result.error,
            }),
          );
          return;
        }
        broadcastRoomState(client.roomId);
        return;
      }

      if (msg.type === "place_event") {
        const { eventId, position } = msg;
        console.log("[roomHub] place_event received", {
          roomId: client.roomId,
          playerId: client.playerId,
          eventId,
          position,
        });
        if (typeof eventId !== "string" || typeof position !== "number") {
          console.log("[roomHub] place_event invalid payload");
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "invalid",
              message: "eventId and position required",
            }),
          );
          return;
        }
        let result: ReturnType<typeof roomService.placeEvent>;
        try {
          result = roomService.placeEvent(
            client.roomId,
            client.playerId,
            eventId,
            position,
          );
        } catch (err) {
          console.error("[roomHub] place_event threw", err);
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "failed",
              message: err instanceof Error ? err.message : "Place failed",
            }),
          );
          broadcastRoomState(client.roomId);
          return;
        }
        if ("error" in result) {
          console.log("[roomHub] place_event error", result.error);
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "failed",
              message: result.error,
            }),
          );
          broadcastRoomState(client.roomId);
          return;
        }
        console.log("[roomHub] place_event success", {
          nextTurnPlayerId: result.nextTurnPlayerId,
          gameEnded: result.gameEnded,
          correct: result.correct,
        });
        const stateAfter = roomService.getRoomState(client.roomId);
        ws.send(
          JSON.stringify({
            type: "place_result",
            ...result,
            currentTurnStartedAt: stateAfter?.currentTurnStartedAt ?? null,
            nextDeckSequence: stateAfter?.nextDeckSequence ?? 0,
          }),
        );
        broadcastRoomState(client.roomId);
        return;
      }

      if (msg.type === "turn_timeout") {
        console.log("[roomHub] turn_timeout received", {
          roomId: client.roomId,
          playerId: client.playerId,
        });
        const result = roomService.timeoutTurn(client.roomId, client.playerId);
        if ("error" in result) {
          console.log("[roomHub] turn_timeout error", result.error);
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "timeout_failed",
              message: result.error,
            }),
          );
          broadcastRoomState(client.roomId);
          return;
        }
        console.log("[roomHub] turn_timeout success", {
          nextTurnPlayerId: result.nextTurnPlayerId,
          gameEnded: result.gameEnded,
        });
        const state = roomService.getRoomState(client.roomId);
        ws.send(
          JSON.stringify({
            type: "place_result",
            correct: false,
            score: state?.scores[client.playerId] ?? 0,
            timeline: result.timeline ?? state?.timeline ?? [],
            nextEvent: result.nextEvent ?? null,
            nextTurnPlayerId: result.nextTurnPlayerId,
            gameEnded: result.gameEnded,
          }),
        );
        broadcastRoomState(client.roomId);
        return;
      }

      if (msg.type === "end_game") {
        const result = roomService.endGame(client.roomId, client.playerId);
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "end_game_error",
              code: "failed",
              message: result.error,
            }),
          );
          return;
        }
        broadcastRoomState(client.roomId);
        return;
      }

      if (msg.type === "rematch") {
        const result = roomService.rematchRoom(client.roomId, client.playerId);
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "rematch_error",
              code: "failed",
              message: result.error,
            }),
          );
          return;
        }
        broadcastRoomState(client.roomId);
        return;
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: e instanceof Error ? e.message : "Invalid message",
        }),
      );
    }
  });

  ws.on("close", () => {
    if (client) {
      const state = roomService.getRoomState(client.roomId);
      if (
        state?.status === "playing" &&
        state.currentTurnPlayerId === client.playerId
      ) {
        console.log("[roomHub] current turn player disconnected, auto timeout", {
          roomId: client.roomId,
          playerId: client.playerId,
        });
        const result = roomService.timeoutTurn(client.roomId, client.playerId);
        if (!("error" in result)) {
          const roomState = roomService.getRoomState(client.roomId);
          getRoomClients(client.roomId).forEach((c) => {
            if (c.ws.readyState === 1) {
              c.ws.send(
                JSON.stringify({
                  type: "place_result",
                  correct: false,
                  score: roomState?.scores[c.playerId] ?? 0,
                  timeline: result.timeline,
                  nextEvent: result.nextEvent ?? null,
                  nextTurnPlayerId: result.nextTurnPlayerId,
                  gameEnded: result.gameEnded,
                  currentTurnStartedAt: roomState?.currentTurnStartedAt ?? null,
                  nextDeckSequence: roomState?.nextDeckSequence ?? 0,
                }),
              );
            }
          });
        }
      }
      roomService.setPlayerConnected(client.roomId, client.playerId, false);
      getRoomClients(client.roomId).delete(client);
      broadcastRoomState(client.roomId);
    }
  });
}
