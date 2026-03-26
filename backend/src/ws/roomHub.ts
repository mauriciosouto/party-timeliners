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

async function broadcastStateUpdate(roomId: string): Promise<void> {
  for (const c of getRoomClients(roomId)) {
    if (c.ws.readyState !== 1) continue;
    const room = await roomService.getRoomState(roomId, c.playerId);
    if (!room) continue;
    c.ws.send(JSON.stringify({ type: "state_update", room }));
  }
}

export function attachRoomHub(ws: WebSocket): void {
  let client: Client | null = null;

  ws.on("message", (raw) => {
    void handleMessage(raw);
  });

  async function handleMessage(raw: WebSocket.RawData): Promise<void> {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type: string;
        roomId?: string;
        playerId?: string;
        nickname?: string;
        avatar?: string;
        email?: string;
        eventId?: string;
        position?: number;
      };

      if (msg.type === "join_room") {
        const { roomId, playerId, nickname, avatar, email } = msg;
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
        const existing = await roomService.getRoomState(roomId);
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
          await roomService.setPlayerConnected(roomId, playerId, true);
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
          const result = await roomService.joinRoom(
            roomId,
            nickname,
            email ?? undefined,
            avatar ?? undefined,
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
        const room = (await roomService.getRoomState(roomId, joinedPlayerId))!;
        ws.send(
          JSON.stringify({
            type: "join_ack",
            playerId: joinedPlayerId,
            roomState: room,
            room,
          }),
        );
        await broadcastStateUpdate(roomId);
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
        const result = await roomService.startGame(client.roomId, client.playerId);
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
        await broadcastStateUpdate(client.roomId);
        return;
      }

      if (msg.type === "place_event") {
        const { eventId, position } = msg;
        if (typeof eventId !== "string" || typeof position !== "number") {
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "invalid",
              message: "eventId and position required",
            }),
          );
          return;
        }
        let result: Awaited<ReturnType<typeof roomService.placeEvent>>;
        try {
          result = await roomService.placeEvent(
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
          await broadcastStateUpdate(client.roomId);
          return;
        }
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "failed",
              message: result.error,
            }),
          );
          await broadcastStateUpdate(client.roomId);
          return;
        }
        const stateAfter = await roomService.getRoomState(client.roomId, client.playerId);
        ws.send(
          JSON.stringify({
            type: "place_result",
            ...result,
            currentTurnStartedAt: stateAfter?.currentTurnStartedAt ?? null,
            lastPlacedEvent: stateAfter?.lastPlacedEvent ?? null,
          }),
        );
        await broadcastStateUpdate(client.roomId);
        return;
      }

      if (msg.type === "turn_timeout") {
        const result = await roomService.timeoutTurn(client.roomId, client.playerId);
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "timeout_failed",
              message: result.error,
            }),
          );
          await broadcastStateUpdate(client.roomId);
          return;
        }
        const state = await roomService.getRoomState(client.roomId, client.playerId);
        ws.send(
          JSON.stringify({
            type: "place_result",
            correct: false,
            score: state?.scores[client.playerId] ?? 0,
            timeline: result.timeline ?? state?.timeline ?? [],
            nextTurnPlayerId: result.nextTurnPlayerId,
            gameEnded: result.gameEnded,
            lastPlacedEvent: state?.lastPlacedEvent ?? null,
          }),
        );
        await broadcastStateUpdate(client.roomId);
        return;
      }

      if (msg.type === "end_game") {
        const result = await roomService.endGame(client.roomId, client.playerId);
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
        await broadcastStateUpdate(client.roomId);
        return;
      }

      if (msg.type === "rematch") {
        const result = await roomService.rematchRoom(client.roomId, client.playerId);
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
        await broadcastStateUpdate(client.roomId);
        return;
      }

      if (msg.type === "leave_room") {
        const result = await roomService.leaveRoom(client.roomId, client.playerId);
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "leave_error",
              message: result.error,
            }),
          );
          return;
        }
        const { roomState, leftPlayerNickname } = result;
        getRoomClients(client.roomId).delete(client);
        await broadcastStateUpdate(client.roomId);
        const playerLeftPayload = JSON.stringify({
          type: "player_left",
          nickname: leftPlayerNickname,
        });
        getRoomClients(client.roomId).forEach((c) => {
          if (c.ws.readyState === 1) c.ws.send(playerLeftPayload);
        });
        ws.send(JSON.stringify({ type: "leave_ack" }));
        return;
      }

      if (msg.type === "close_room") {
        const room = await roomService.getRoomState(client.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: "close_room_error", message: "Room not found" }));
          return;
        }
        if (room.status !== "lobby" && room.status !== "ended") {
          ws.send(
            JSON.stringify({
              type: "close_room_error",
              message:
                "Only the host can close the room when in lobby or after the game has ended",
            }),
          );
          return;
        }
        if (room.hostPlayerId !== client.playerId) {
          ws.send(JSON.stringify({ type: "close_room_error", message: "Only the host can close the room" }));
          return;
        }
        const result = await roomService.closeRoomPermanently(client.roomId, client.playerId);
        if ("error" in result) {
          ws.send(JSON.stringify({ type: "close_room_error", message: result.error }));
          return;
        }
        const payload = JSON.stringify({ type: "room_closed" });
        getRoomClients(client.roomId).forEach((c) => {
          if (c.ws.readyState === 1) c.ws.send(payload);
        });
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
  }

  ws.on("close", () => {
    void (async () => {
      if (client) {
        const state = await roomService.getRoomState(client.roomId, client.playerId);
        if (
          state?.status === "playing" &&
          state.currentTurnPlayerId === client.playerId
        ) {
          const result = await roomService.timeoutTurn(client.roomId, client.playerId);
          if (!("error" in result)) {
            await broadcastStateUpdate(client.roomId);
          }
        }
        await roomService.setPlayerConnected(client.roomId, client.playerId, false);
        getRoomClients(client.roomId).delete(client);
        await broadcastStateUpdate(client.roomId);
      }
    })();
  });
}
