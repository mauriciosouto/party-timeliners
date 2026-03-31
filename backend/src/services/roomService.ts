/**
 * Rooms are held in memory (liveRoomStore). PostgreSQL is used for the events pool
 * and for optional end-of-match rows in room_match_metrics.
 */
import type { ApiEvent, ApiTimelineEntry, PlaceResult, RoomState, EventRecord } from "../types.js";
import { queryOne, queryRows, rowCount } from "../db/index.js";
import { primeEventCache } from "../db/eventCache.js";
import { createPerfSpan } from "../perf.js";
import { buildDeck } from "../game/deck.js";
import * as live from "./liveRoomStore.js";

export type CreateRoomOptions = live.CreateRoomOptions;
export { CARDS_PER_HAND, DRAW_POOL_SIZE } from "./liveRoomStore.js";

function eventToEventLike(e: EventRecord): EventRecord & { wikipediaUrl?: string | null } {
  return { ...e, wikipediaUrl: e.wikipedia_url };
}

type DeckLoadOk = { fullDeck: EventRecord[] };

async function loadEventsForNewGame(totalCardsNeeded: number): Promise<DeckLoadOk | null> {
  const countRow = await queryOne<{ c: unknown }>("SELECT COUNT(*)::int AS c FROM events", []);
  const total = rowCount(countRow, "c");
  if (total < totalCardsNeeded) return null;

  let overfetch = Math.min(total, Math.max(totalCardsNeeded * 25, 1500));
  const hardCap = Math.min(total, 8000);

  for (let attempt = 0; attempt < 10; attempt++) {
    const limit = Math.min(overfetch, hardCap);
    const offset = total > limit ? Math.floor(Math.random() * (total - limit + 1)) : 0;
    const slice = await queryRows<EventRecord>("SELECT * FROM events LIMIT ? OFFSET ?", [
      limit,
      offset,
    ]);
    const fullDeck = buildDeck(slice.map(eventToEventLike), totalCardsNeeded) as EventRecord[];
    if (fullDeck.length >= totalCardsNeeded) {
      primeEventCache(slice);
      return { fullDeck };
    }
    overfetch = Math.min(hardCap, Math.ceil(overfetch * 1.4));
  }

  console.warn("[roomService] Deck sampling exhausted retries; loading full events table (slow).");
  const all = await queryRows<EventRecord>("SELECT * FROM events", []);
  if (all.length < totalCardsNeeded) return null;
  const fullDeck = buildDeck(all.map(eventToEventLike), totalCardsNeeded) as EventRecord[];
  if (fullDeck.length < totalCardsNeeded) return null;
  primeEventCache(all);
  return { fullDeck };
}

export async function createRoom(
  hostNickname: string,
  roomName?: string,
  options?: CreateRoomOptions,
): Promise<{
  roomId: string;
  playerId: string;
  roomState: RoomState;
}> {
  return live.createRoom(hostNickname, roomName, options);
}

export async function joinRoom(
  roomId: string,
  nickname: string,
  email?: string,
  avatar?: string | null,
): Promise<{ playerId: string; roomState: RoomState } | { error: string }> {
  return live.joinRoom(roomId, nickname, email, avatar);
}

export async function getRoomState(roomId: string, forPlayerId?: string): Promise<RoomState | null> {
  return live.getRoomState(roomId, forPlayerId);
}

export async function getRoomStatesForClients(
  roomId: string,
  clientPlayerIds: readonly string[],
): Promise<Map<string, RoomState>> {
  return live.getRoomStatesForClients(roomId, clientPlayerIds);
}

export async function startGame(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  const needed = live.getTotalCardsNeededForStart(roomId);
  if (needed == null) return { error: "Room not found" };
  const loaded = await loadEventsForNewGame(needed);
  if (!loaded) {
    return { error: "Not enough events in pool. Run seed first." };
  }
  return live.applyStartGame(roomId, playerId, loaded.fullDeck);
}

export async function getNextEventForCurrentTurn(
  roomId: string,
  playerId: string,
): Promise<ApiEvent | null> {
  return live.getNextEventForCurrentTurn(roomId, playerId);
}

export async function placeEvent(
  roomId: string,
  playerId: string,
  eventId: string,
  position: number,
): Promise<PlaceResult | { error: string }> {
  const perf = createPerfSpan("roomService.placeEvent", {
    roomIdShort: roomId.slice(0, 8),
  });
  const result = await live.placeEvent(roomId, playerId, eventId, position);
  if ("error" in result) {
    perf.end({ outcome: "error" });
  } else {
    perf.end({
      outcome: result.correct ? "correct" : "incorrect",
      gameEnded: result.gameEnded ?? false,
    });
  }
  return result;
}

export async function timeoutTurn(
  roomId: string,
  playerId: string,
): Promise<
  | {
      nextTurnPlayerId: string | null;
      nextEvent: ApiEvent | null;
      gameEnded?: boolean;
      timeline: ApiTimelineEntry[];
    }
  | { error: string }
> {
  return live.timeoutTurn(roomId, playerId);
}

export async function endGame(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  return live.endGame(roomId, playerId);
}

export async function rematchRoom(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  return live.rematchRoom(roomId, playerId);
}

export async function leaveRoom(
  roomId: string,
  playerId: string,
): Promise<{ roomState: RoomState; leftPlayerNickname: string } | { error: string }> {
  return live.leaveRoom(roomId, playerId);
}

export async function closeRoomPermanently(
  roomId: string,
  playerId: string,
): Promise<{ ok: true } | { error: string }> {
  return live.closeRoomPermanently(roomId, playerId);
}

export async function setPlayerConnected(
  roomId: string,
  playerId: string,
  connected: boolean,
): Promise<void> {
  live.setPlayerConnected(roomId, playerId, connected);
}
