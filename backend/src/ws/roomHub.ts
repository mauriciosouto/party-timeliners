import type { WebSocket } from "ws";
import { createPerfSpan } from "../perf.js";
import type { RoomState } from "../types.js";
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

function broadcastToRoom(roomId: string, payload: Record<string, unknown>): void {
  const clients = getRoomClients(roomId);
  const raw = JSON.stringify(payload);
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue;
    c.ws.send(raw);
  }
}

async function broadcastStateUpdate(
  roomId: string,
  prebuiltStates?: Map<string, RoomState>,
): Promise<void> {
  const b = createPerfSpan("roomHub.broadcastStateUpdate", {
    roomIdShort: roomId.slice(0, 8),
    prebuilt: Boolean(prebuiltStates),
  });
  const clients = getRoomClients(roomId);
  if (clients.size === 0) {
    b.end({ skipped: true, reason: "no_clients" });
    return;
  }
  const ids = [...clients].map((c) => c.playerId);
  const states =
    prebuiltStates ?? (await roomService.getRoomStatesForClients(roomId, ids));
  b.mark(prebuiltStates ? "reuse_states" : "getRoomStatesForClients");
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue;
    const room = states.get(c.playerId);
    if (!room) continue;
    c.ws.send(JSON.stringify({ type: "state_update", room }));
  }
  b.mark("ws_send_all");
  b.end({ clientCount: ids.length });
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
        broadcastToRoom(client.roomId, { type: "game_starting" });
        const result = await roomService.startGame(client.roomId, client.playerId);
        if ("error" in result) {
          broadcastToRoom(client.roomId, {
            type: "game_start_failed",
            message: result.error,
          });
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
        const hubPerf = createPerfSpan("roomHub.place_event", {
          roomIdShort: client.roomId.slice(0, 8),
        });
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
          hubPerf.mark("after_placeEvent");
          hubPerf.end({ outcome: "throw" });
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
        hubPerf.mark("after_placeEvent");
        if ("error" in result) {
          ws.send(
            JSON.stringify({
              type: "place_error",
              code: "failed",
              message: result.error,
            }),
          );
          await broadcastStateUpdate(client.roomId);
          hubPerf.mark("after_broadcast");
          hubPerf.end({ outcome: "service_error" });
          return;
        }
        const clients = getRoomClients(client.roomId);
        const ids = [...clients].map((c) => c.playerId);
        const states = await roomService.getRoomStatesForClients(client.roomId, ids);
        hubPerf.mark("after_getRoomStatesForClients");
        ws.send(JSON.stringify({ type: "place_result", ...result }));
        await broadcastStateUpdate(client.roomId, states);
        hubPerf.mark("after_broadcast");
        hubPerf.end({ outcome: "ok" });
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
        const clientsT = getRoomClients(client.roomId);
        const idsT = [...clientsT].map((c) => c.playerId);
        const statesT = await roomService.getRoomStatesForClients(client.roomId, idsT);
        const actorT = statesT.get(client.playerId);
        ws.send(
          JSON.stringify({
            type: "place_result",
            correct: false,
            score: actorT?.scores[client.playerId] ?? 0,
            streak: 0,
            timeline: result.timeline ?? actorT?.timeline ?? [],
            nextTurnPlayerId: result.nextTurnPlayerId,
            gameEnded: result.gameEnded,
            lastPlacedEvent: actorT?.lastPlacedEvent ?? null,
            currentTurnStartedAt: actorT?.currentTurnStartedAt ?? null,
          }),
        );
        await broadcastStateUpdate(client.roomId, statesT);
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
        broadcastToRoom(client.roomId, { type: "rematch_starting" });
        const result = await roomService.rematchRoom(client.roomId, client.playerId);
        if ("error" in result) {
          broadcastToRoom(client.roomId, {
            type: "rematch_failed",
            message: result.error,
          });
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
        broadcastToRoom(client.roomId, { type: "close_room_starting" });
        const result = await roomService.closeRoomPermanently(client.roomId, client.playerId);
        if ("error" in result) {
          broadcastToRoom(client.roomId, {
            type: "close_room_failed",
            message: result.error,
          });
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
