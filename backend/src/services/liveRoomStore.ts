import { randomUUID } from "node:crypto";
import type {
  ApiEvent,
  ApiTimelineEntry,
  LastPlacedEvent,
  PlaceResult,
  RoomPlayerState,
  RoomState,
  RoomStatus,
  EventRecord,
} from "../types.js";
import { ensureEventIdsInCache, getCachedEvent } from "../db/eventCache.js";
import {
  clearRoomGameEvents,
  getRoomGameEvent,
  primeRoomGameEvents,
} from "../db/roomEventStore.js";
import { shuffle } from "../game/deck.js";
import { validatePlace, getNextTurnPlayerId } from "../game/validation.js";
import { schedulePersistRoomMatch, type RoomMatchPersistReason } from "./roomMatchPersistence.js";

const DEFAULT_MAX_TIMELINE_SIZE = 50;
const DEFAULT_POINTS_TO_WIN = 2;
const DEFAULT_TURN_TIME_LIMIT_SECONDS = 60;
export const CARDS_PER_HAND = 3;
export const DRAW_POOL_SIZE = 150;

type LiveTimelineRow = {
  eventId: string;
  position: number;
  placedByPlayerId: string | null;
  placedAt: string;
};

type LivePlayer = {
  playerId: string;
  nickname: string;
  avatar: string | null;
  email: string | null;
  isHost: boolean;
  connected: boolean;
  joinedAt: string;
  score: number;
  streak: number;
  turnOrder: number | null;
};

export type CreateRoomOptions = {
  maxTimelineSize?: number;
  pointsToWin?: number;
  turnTimeLimitSeconds?: number | null;
  avatar?: string | null;
};

type LiveRoom = {
  roomId: string;
  name: string;
  status: RoomStatus;
  hostPlayerId: string;
  maxTimelineSize: number;
  pointsToWin: number;
  turnTimeLimitSeconds: number | null;
  players: Map<string, LivePlayer>;
  initialEventId: string | null;
  turnIndex: number;
  turnStartedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  winnerPlayerId: string | null;
  nextDeckSequence: number;
  timeline: LiveTimelineRow[];
  deck: string[];
  hands: Map<string, string[]>;
};

const rooms = new Map<string, LiveRoom>();

function eventToApi(e: EventRecord): ApiEvent {
  return {
    id: e.id,
    title: e.title,
    year: e.year,
    displayTitle: e.display_title,
    image: e.image ?? undefined,
    wikipediaUrl: e.wikipedia_url ?? undefined,
  };
}

function uniqueEventRecordsById(events: readonly EventRecord[]): EventRecord[] {
  const m = new Map<string, EventRecord>();
  for (const e of events) m.set(e.id, e);
  return [...m.values()];
}

function getResolvedEvent(
  roomId: string,
  status: RoomStatus,
  eventId: string,
): EventRecord | undefined {
  if (status === "playing" || status === "ended") {
    const hit = getRoomGameEvent(roomId, eventId);
    if (hit) return hit;
  }
  return getCachedEvent(eventId);
}

async function ensureEventsResolvedForRoom(
  roomId: string,
  status: RoomStatus,
  ids: readonly string[],
): Promise<void> {
  if (status !== "playing" && status !== "ended") {
    await ensureEventIdsInCache(ids);
    return;
  }
  const unique = [...new Set(ids.filter(Boolean))];
  const missing = unique.filter((id) => !getRoomGameEvent(roomId, id) && !getCachedEvent(id));
  if (missing.length === 0) return;
  await ensureEventIdsInCache(missing);
}

function isoZ(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.length === 19 && !raw.endsWith("Z")) return `${raw}Z`;
  return raw;
}

function shiftTimelineForInsert(timeline: LiveTimelineRow[], insertAt: number): void {
  for (const row of timeline) {
    if (row.position >= insertAt) row.position += 1;
  }
}

function pickWinnerFromRoom(room: LiveRoom): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const p of room.players.values()) {
    if (p.score > bestScore) {
      bestScore = p.score;
      best = p.playerId;
    }
  }
  return best;
}

function endMatchInRoom(room: LiveRoom, winnerPlayerId: string | null, nowIso: string): void {
  room.status = "ended";
  room.endedAt = nowIso;
  room.winnerPlayerId = winnerPlayerId;
}

/** Event IDs referenced by active matches (for event pool maintenance). */
export function collectLiveRoomReferencedEventIds(): Set<string> {
  const s = new Set<string>();
  for (const room of rooms.values()) {
    if (room.status !== "playing" && room.status !== "ended") continue;
    if (room.initialEventId) s.add(room.initialEventId);
    for (const t of room.timeline) s.add(t.eventId);
    for (const id of room.deck) s.add(id);
    for (const h of room.hands.values()) {
      for (const id of h) s.add(id);
    }
  }
  return s;
}

export function getLiveRoomStatusCounts(): {
  roomsTotal: number;
  roomsInLobby: number;
  roomsPlaying: number;
  roomsEnded: number;
} {
  let roomsInLobby = 0;
  let roomsPlaying = 0;
  let roomsEnded = 0;
  for (const r of rooms.values()) {
    if (r.status === "lobby") roomsInLobby++;
    else if (r.status === "playing") roomsPlaying++;
    else roomsEnded++;
  }
  return {
    roomsTotal: rooms.size,
    roomsInLobby,
    roomsPlaying,
    roomsEnded,
  };
}

function sortedTimeline(room: LiveRoom): LiveTimelineRow[] {
  return [...room.timeline].sort((a, b) => a.position - b.position);
}

function turnOrderedIds(room: LiveRoom): string[] {
  const list = [...room.players.values()].sort(
    (a, b) => (a.turnOrder ?? 999) - (b.turnOrder ?? 999),
  );
  return list.map((p) => p.playerId);
}

async function buildRoomState(room: LiveRoom, forPlayerId?: string): Promise<RoomState> {
  const timelineRows = sortedTimeline(room);
  await ensureEventsResolvedForRoom(
    room.roomId,
    room.status,
    timelineRows.map((t) => t.eventId),
  );

  const playerList = [...room.players.values()].sort(
    (a, b) => a.joinedAt.localeCompare(b.joinedAt),
  );

  const players: RoomPlayerState[] = playerList.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    avatar: p.avatar ?? undefined,
    isHost: p.isHost,
    score: p.score,
    streak: p.streak,
    turnOrder: p.turnOrder,
    connected: p.connected,
    joinedAt: p.joinedAt,
  }));

  const scores: Record<string, number> = {};
  for (const p of playerList) scores[p.playerId] = p.score;

  const timeline: ApiTimelineEntry[] = timelineRows.flatMap((row) => {
    const rec = getResolvedEvent(room.roomId, room.status, row.eventId);
    if (!rec) return [];
    return [
      {
        event: eventToApi(rec),
        position: row.position,
        placedByPlayerId: row.placedByPlayerId,
        placedAt: row.placedAt,
      },
    ];
  });

  const lastPlacedEntry = timeline
    .filter((e) => e.placedByPlayerId != null && e.placedAt != null)
    .sort(
      (a, b) => new Date(b.placedAt!).getTime() - new Date(a.placedAt!).getTime(),
    )[0];
  const lastPlacedEvent: LastPlacedEvent | null = lastPlacedEntry
    ? {
        eventId: lastPlacedEntry.event.id,
        title: lastPlacedEntry.event.title,
        year: lastPlacedEntry.event.year,
        image: lastPlacedEntry.event.image ?? null,
        placedByPlayerId: lastPlacedEntry.placedByPlayerId!,
      }
    : null;

  let turnOrder: string[] = [];
  let currentTurnPlayerId: string | null = null;
  let currentTurnStartedAt: string | null = null;
  let myHand: ApiEvent[] = [];

  if (room.status === "playing" && room.players.size > 0) {
    turnOrder = turnOrderedIds(room);
    currentTurnPlayerId = turnOrder[room.turnIndex] ?? null;
    const raw = room.turnStartedAt ?? room.startedAt;
    currentTurnStartedAt = isoZ(raw);
    if (forPlayerId) {
      const handIds = room.hands.get(forPlayerId) ?? [];
      await ensureEventsResolvedForRoom(room.roomId, room.status, handIds);
      myHand = handIds.flatMap((id) => {
        const rec = getResolvedEvent(room.roomId, room.status, id);
        return rec ? [eventToApi(rec)] : [];
      });
    }
  }

  return {
    roomId: room.roomId,
    name: room.name,
    status: room.status,
    hostPlayerId: room.hostPlayerId,
    maxTimelineSize: room.maxTimelineSize,
    pointsToWin: room.pointsToWin,
    turnTimeLimitSeconds: room.turnTimeLimitSeconds,
    players,
    timeline,
    scores,
    turnOrder,
    currentTurnPlayerId,
    currentTurnStartedAt,
    myHand,
    nextDeckSequence: room.nextDeckSequence,
    initialEventId: room.initialEventId,
    endedAt: room.endedAt,
    winnerPlayerId: room.winnerPlayerId,
    lastPlacedEvent,
  };
}

function removeFromHandAndDraw(room: LiveRoom, playerId: string, eventId: string): void {
  const hand = [...(room.hands.get(playerId) ?? [])].filter((id) => id !== eventId);
  const nextId = room.deck.shift();
  if (nextId) hand.push(nextId);
  room.hands.set(playerId, hand);
}

function snapshotAndPersist(reason: RoomMatchPersistReason, room: LiveRoom): void {
  void buildRoomState(room).then((state) => schedulePersistRoomMatch(reason, state));
}

export async function getRoomState(roomId: string, forPlayerId?: string): Promise<RoomState | null> {
  const room = rooms.get(roomId);
  if (!room) return null;
  return buildRoomState(room, forPlayerId);
}

export async function getRoomStatesForClients(
  roomId: string,
  clientPlayerIds: readonly string[],
): Promise<Map<string, RoomState>> {
  const out = new Map<string, RoomState>();
  const room = rooms.get(roomId);
  if (!room) return out;
  const base = await buildRoomState(room);
  if (base.status !== "playing") {
    for (const id of clientPlayerIds) out.set(id, { ...base, myHand: [] });
    return out;
  }
  for (const id of clientPlayerIds) {
    out.set(id, await buildRoomState(room, id));
  }
  return out;
}

export function createRoom(
  hostNickname: string,
  roomName?: string,
  options?: CreateRoomOptions,
): Promise<{ roomId: string; playerId: string; roomState: RoomState }> {
  const roomId = randomUUID();
  const playerId = randomUUID();
  const maxTimelineSize = options?.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE;
  const pointsToWin = options?.pointsToWin ?? DEFAULT_POINTS_TO_WIN;
  const raw = options?.turnTimeLimitSeconds;
  const turnTimeLimitSeconds =
    raw === undefined ? DEFAULT_TURN_TIME_LIMIT_SECONDS : raw === null ? null : Number(raw);
  const avatar = options?.avatar ?? null;
  const joinedAt = new Date().toISOString();

  const host: LivePlayer = {
    playerId,
    nickname: hostNickname,
    avatar,
    email: null,
    isHost: true,
    connected: true,
    joinedAt,
    score: 0,
    streak: 0,
    turnOrder: null,
  };

  const room: LiveRoom = {
    roomId,
    name: roomName ?? "Party Timeliners",
    status: "lobby",
    hostPlayerId: playerId,
    maxTimelineSize,
    pointsToWin,
    turnTimeLimitSeconds,
    players: new Map([[playerId, host]]),
    initialEventId: null,
    turnIndex: 0,
    turnStartedAt: null,
    startedAt: null,
    endedAt: null,
    winnerPlayerId: null,
    nextDeckSequence: 0,
    timeline: [],
    deck: [],
    hands: new Map(),
  };

  rooms.set(roomId, room);
  return buildRoomState(room).then((roomState) => ({ roomId, playerId, roomState }));
}

export async function joinRoom(
  roomId: string,
  nickname: string,
  email?: string,
  avatar?: string | null,
): Promise<{ playerId: string; roomState: RoomState } | { error: string }> {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "Game already started" };

  const playerId = randomUUID();
  const joinedAt = new Date().toISOString();
  room.players.set(playerId, {
    playerId,
    nickname,
    avatar: avatar ?? null,
    email: email ?? null,
    isHost: false,
    connected: true,
    joinedAt,
    score: 0,
    streak: 0,
    turnOrder: null,
  });
  return { playerId, roomState: await buildRoomState(room) };
}

export function getTotalCardsNeededForStart(roomId: string): number | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  const n = room.players.size;
  return 1 + CARDS_PER_HAND * n + DRAW_POOL_SIZE;
}

export async function applyStartGame(
  roomId: string,
  playerId: string,
  fullDeck: EventRecord[],
): Promise<RoomState | { error: string }> {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "Game already started" };
  if (room.hostPlayerId !== playerId) return { error: "Only host can start" };

  const playerRows = [...room.players.values()].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const playerCount = playerRows.length;
  const connectedCount = playerRows.filter((p) => p.connected).length;
  if (playerCount < 2 || connectedCount < 2) {
    return { error: "At least 2 players are required to start. Wait for another player to join." };
  }

  const playerIds = playerRows.map((p) => p.playerId);
  const N = playerIds.length;
  const totalCardsNeeded = 1 + CARDS_PER_HAND * N + DRAW_POOL_SIZE;
  if (fullDeck.length < totalCardsNeeded) return { error: "Failed to build deck" };

  const initialEvent = fullDeck[0];
  const handEvents = fullDeck.slice(1, 1 + CARDS_PER_HAND * N);
  const drawEventRecords = fullDeck.slice(1 + CARDS_PER_HAND * N);
  if (!initialEvent) return { error: "Failed to build deck" };

  const turnOrderShuffle = shuffle(playerIds);
  const nowIso = new Date().toISOString();
  const hands = new Map<string, string[]>();

  for (let playerIndex = 0; playerIndex < turnOrderShuffle.length; playerIndex++) {
    const pid = turnOrderShuffle[playerIndex]!;
    const slice: string[] = [];
    for (let s = 0; s < CARDS_PER_HAND; s++) {
      const ev = handEvents[playerIndex * CARDS_PER_HAND + s];
      if (ev) slice.push(ev.id);
    }
    hands.set(pid, slice);
  }

  for (const p of room.players.values()) {
    p.turnOrder = null;
    p.score = 0;
    p.streak = 0;
  }
  for (let i = 0; i < turnOrderShuffle.length; i++) {
    const pid = turnOrderShuffle[i]!;
    const pl = room.players.get(pid);
    if (pl) pl.turnOrder = i;
  }

  room.status = "playing";
  room.initialEventId = initialEvent.id;
  room.nextDeckSequence = 0;
  room.turnIndex = 0;
  room.turnStartedAt = nowIso;
  room.startedAt = nowIso;
  room.endedAt = null;
  room.winnerPlayerId = null;
  room.timeline = [
    {
      eventId: initialEvent.id,
      position: 0,
      placedByPlayerId: null,
      placedAt: nowIso,
    },
  ];
  room.deck = drawEventRecords.map((e) => e.id);
  room.hands = hands;

  clearRoomGameEvents(roomId);
  primeRoomGameEvents(roomId, uniqueEventRecordsById(fullDeck));

  return buildRoomState(room, turnOrderShuffle[0] ?? undefined);
}

function maybeEndByTimeline(
  room: LiveRoom,
  timelineLength: number,
  nowIso: string,
): boolean {
  const maxTimelineSize = room.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE;
  if (timelineLength < maxTimelineSize) return false;
  const winner = pickWinnerFromRoom(room);
  endMatchInRoom(room, winner, nowIso);
  snapshotAndPersist("game_finished", room);
  return true;
}

export async function placeEvent(
  roomId: string,
  playerId: string,
  eventId: string,
  position: number,
): Promise<PlaceResult | { error: string }> {
  const room = rooms.get(roomId);
  if (!room || room.status !== "playing") {
    return { error: "Room not found or not playing" };
  }

  const turnOrder = turnOrderedIds(room);
  const currentPlayerId = turnOrder[room.turnIndex] ?? null;

  const timelineMeta = sortedTimeline(room);
  const handRows = room.hands.get(playerId) ?? [];

  await ensureEventsResolvedForRoom(roomId, "playing", [
    ...timelineMeta.map((t) => t.eventId),
    eventId,
    ...handRows,
  ]);

  const event = getResolvedEvent(roomId, "playing", eventId);
  if (!event) return { error: "Event not found" };

  const handEventIds = new Set(handRows);
  const timelineYears = timelineMeta.map(
    (t) => getResolvedEvent(room.roomId, "playing", t.eventId)?.year ?? 0,
  );
  const currentPlayer = room.players.get(playerId);
  const currentPlayerScore = currentPlayer?.score ?? 0;

  const validation = validatePlace(
    playerId,
    eventId,
    position,
    { ...event, year: event.year },
    {
      currentTurnPlayerId: currentPlayerId,
      turnOrder,
      turnIndex: room.turnIndex,
      handEventIds,
      timelineYears,
      timelineLength: timelineYears.length,
      maxTimelineSize: room.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE,
      pointsToWin: room.pointsToWin ?? DEFAULT_POINTS_TO_WIN,
      currentPlayerScore,
    },
  );

  if (!validation.valid) return { error: validation.error };

  const { correct, correctPosition } = validation;
  const numPlayers = turnOrder.length;
  const nextTurnIndex = (room.turnIndex + 1) % numPlayers;
  const nextTurnPlayerId = getNextTurnPlayerId(turnOrder, room.turnIndex);

  if (!correct) {
    const nowIso = new Date().toISOString();
    const pl = room.players.get(playerId);
    if (pl) pl.streak = 0;
    removeFromHandAndDraw(room, playerId, eventId);
    shiftTimelineForInsert(room.timeline, correctPosition);
    room.timeline.push({
      eventId,
      position: correctPosition,
      placedByPlayerId: playerId,
      placedAt: nowIso,
    });
    room.turnIndex = nextTurnIndex;
    room.turnStartedAt = nowIso;

    let state = await buildRoomState(room);
    const newTimelineLength = state.timeline.length;
    if (maybeEndByTimeline(room, newTimelineLength, nowIso)) {
      state = await buildRoomState(room);
      return {
        correct: false,
        gameEnded: true,
        correctPosition,
        score: currentPlayerScore,
        streak: 0,
        timeline: state.timeline,
        nextTurnPlayerId: null,
        currentTurnStartedAt: state.currentTurnStartedAt ?? null,
        lastPlacedEvent: state.lastPlacedEvent ?? null,
      };
    }

    return {
      correct: false,
      gameEnded: false,
      correctPosition,
      score: currentPlayerScore,
      streak: 0,
      timeline: state.timeline,
      nextTurnPlayerId,
      currentTurnStartedAt: state.currentTurnStartedAt ?? null,
      lastPlacedEvent: state.lastPlacedEvent ?? null,
    };
  }

  const newTimelineLength = timelineYears.length + 1;
  const newScore = currentPlayerScore + 1;
  const maxTimelineSize = room.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE;
  const pointsToWin = room.pointsToWin ?? DEFAULT_POINTS_TO_WIN;
  const gameEndsByTimeline = newTimelineLength >= maxTimelineSize;
  const gameEndsByScore = newScore >= pointsToWin;

  const nowIsoCorrect = new Date().toISOString();
  removeFromHandAndDraw(room, playerId, eventId);
  shiftTimelineForInsert(room.timeline, position);
  room.timeline.push({
    eventId,
    position,
    placedByPlayerId: playerId,
    placedAt: nowIsoCorrect,
  });
  if (currentPlayer) {
    currentPlayer.score += 1;
    currentPlayer.streak += 1;
  }
  room.turnIndex = nextTurnIndex;
  room.turnStartedAt = nowIsoCorrect;

  let state = await buildRoomState(room);

  if (gameEndsByTimeline || gameEndsByScore) {
    const winner = pickWinnerFromRoom(room);
    endMatchInRoom(room, winner, new Date().toISOString());
    snapshotAndPersist("game_finished", room);
    state = await buildRoomState(room);
    return {
      correct: true,
      gameEnded: true,
      score: state.scores[playerId] ?? 0,
      streak: state.players.find((p) => p.playerId === playerId)?.streak ?? 0,
      timeline: state.timeline,
      nextTurnPlayerId: null,
      currentTurnStartedAt: state.currentTurnStartedAt ?? null,
      lastPlacedEvent: state.lastPlacedEvent ?? null,
    };
  }

  return {
    correct: true,
    score: state.scores[playerId] ?? 0,
    streak: state.players.find((p) => p.playerId === playerId)?.streak ?? 0,
    timeline: state.timeline,
    nextTurnPlayerId,
    currentTurnStartedAt: state.currentTurnStartedAt ?? null,
    lastPlacedEvent: state.lastPlacedEvent ?? null,
  };
}

function resetRoomToLobby(room: LiveRoom): void {
  room.status = "lobby";
  room.initialEventId = null;
  room.nextDeckSequence = 0;
  room.turnIndex = 0;
  room.turnStartedAt = null;
  room.startedAt = null;
  room.endedAt = null;
  room.winnerPlayerId = null;
  room.timeline = [];
  room.deck = [];
  room.hands = new Map();
  for (const p of room.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.turnOrder = null;
  }
}

export async function getNextEventForCurrentTurn(
  roomId: string,
  playerId: string,
): Promise<ApiEvent | null> {
  const state = await getRoomState(roomId, playerId);
  if (!state || state.status !== "playing" || state.myHand.length === 0) return null;
  if (state.currentTurnPlayerId !== playerId) return null;
  return state.myHand[0] ?? null;
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
  const room = rooms.get(roomId);
  if (!room || room.status !== "playing") {
    return { error: "Room not found or not playing" };
  }
  if (room.turnTimeLimitSeconds == null) {
    return { error: "No turn time limit set" };
  }

  const turnOrder = turnOrderedIds(room);
  const currentPlayerId = turnOrder[room.turnIndex];
  if (currentPlayerId !== playerId) return { error: "Not your turn" };

  const hand = room.hands.get(playerId) ?? [];
  const eventId = hand[0];
  if (!eventId) return { error: "No card in hand for this turn" };

  const timelineMeta = sortedTimeline(room);
  await ensureEventsResolvedForRoom(roomId, "playing", [...timelineMeta.map((t) => t.eventId), eventId]);

  const event = getResolvedEvent(roomId, "playing", eventId);
  if (!event) return { error: "Event not found" };

  const timelineYearsOrdered = timelineMeta.map(
    (t) => getResolvedEvent(room.roomId, "playing", t.eventId)?.year ?? 0,
  );

  const correctIndex = timelineYearsOrdered.findIndex((y) => y > event.year);
  const correctPosition = correctIndex === -1 ? timelineYearsOrdered.length : correctIndex;
  const numPlayers = turnOrder.length;
  const nextTurnIndex = (room.turnIndex + 1) % numPlayers;
  const nextTurnPlayerId = turnOrder[nextTurnIndex] ?? null;

  const nowIsoT = new Date().toISOString();
  const pl = room.players.get(playerId);
  if (pl) pl.streak = 0;
  removeFromHandAndDraw(room, playerId, eventId);
  shiftTimelineForInsert(room.timeline, correctPosition);
  room.timeline.push({
    eventId,
    position: correctPosition,
    placedByPlayerId: playerId,
    placedAt: nowIsoT,
  });
  room.turnIndex = nextTurnIndex;
  room.turnStartedAt = nowIsoT;

  let state = await buildRoomState(room);
  const maxTimelineSize = room.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE;
  if (state.timeline.length >= maxTimelineSize) {
    const winner = pickWinnerFromRoom(room);
    endMatchInRoom(room, winner, new Date().toISOString());
    snapshotAndPersist("game_finished", room);
    state = await buildRoomState(room);
    return {
      nextTurnPlayerId: null,
      nextEvent: null,
      gameEnded: true,
      timeline: state.timeline,
    };
  }

  return {
    nextTurnPlayerId,
    nextEvent: null,
    gameEnded: false,
    timeline: state.timeline,
  };
}

export async function endGame(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.status !== "playing") return { error: "Game is not in progress" };
  if (room.hostPlayerId !== playerId) return { error: "Only the host can end the game" };

  snapshotAndPersist("host_aborted", room);
  clearRoomGameEvents(roomId);
  resetRoomToLobby(room);
  return buildRoomState(room);
}

export async function rematchRoom(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.status !== "ended") return { error: "Game is not finished" };
  if (room.hostPlayerId !== playerId) return { error: "Only the host can start a revanche" };

  const playerRows = [...room.players.values()];
  const playerCount = playerRows.length;
  const connectedCount = playerRows.filter((p) => p.connected).length;
  if (playerCount < 2 || connectedCount < 2) {
    return {
      error: "At least 2 players are required for a rematch. Wait for another player to join.",
    };
  }

  clearRoomGameEvents(roomId);
  resetRoomToLobby(room);
  return buildRoomState(room);
}

export async function leaveRoom(
  roomId: string,
  playerId: string,
): Promise<{ roomState: RoomState; leftPlayerNickname: string } | { error: string }> {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.hostPlayerId === playerId) {
    return { error: "Host cannot leave; use End game to return to lobby" };
  }

  const playerRow = room.players.get(playerId);
  if (!playerRow) return { error: "Player not in room" };
  const leftPlayerNickname = playerRow.nickname;

  if (room.status === "lobby") {
    room.players.delete(playerId);
    return { roomState: await buildRoomState(room), leftPlayerNickname };
  }

  if (room.status !== "playing") {
    return { error: "Room is not in lobby or playing" };
  }

  const orderedIds = turnOrderedIds(room);
  const leavingIndex = orderedIds.indexOf(playerId);
  if (leavingIndex === -1) return { error: "Player not in room" };

  const currentTurnPlayerId = orderedIds[room.turnIndex] ?? null;
  const wasCurrentTurn = currentTurnPlayerId === playerId;
  const newOrderedIds = orderedIds.filter((id) => id !== playerId);

  let newTurnIndexResolved: number | undefined;
  if (newOrderedIds.length >= 2) {
    const nextPlayerId = wasCurrentTurn
      ? orderedIds[(room.turnIndex + 1) % orderedIds.length]
      : currentTurnPlayerId;
    const idx = newOrderedIds.indexOf(nextPlayerId!);
    if (idx === -1) return { error: "Could not update turn order after player left" };
    newTurnIndexResolved = idx;
  }

  room.hands.delete(playerId);
  room.players.delete(playerId);

  if (newOrderedIds.length < 2) {
    snapshotAndPersist("players_left_abort", room);
    clearRoomGameEvents(roomId);
    resetRoomToLobby(room);
  } else {
    for (let i = 0; i < newOrderedIds.length; i++) {
      const pid = newOrderedIds[i]!;
      const pl = room.players.get(pid);
      if (pl) pl.turnOrder = i;
    }
    room.turnIndex = newTurnIndexResolved!;
    room.turnStartedAt = new Date().toISOString();
  }

  const roomState = await buildRoomState(room, newOrderedIds[0]);
  return { roomState, leftPlayerNickname };
}

export async function closeRoomPermanently(
  roomId: string,
  playerId: string,
): Promise<{ ok: true } | { error: string }> {
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found" };
  if (room.hostPlayerId !== playerId) return { error: "Only the host can close the room" };
  if (room.status === "playing" || room.status === "ended") {
    snapshotAndPersist("room_closed", room);
  }
  clearRoomGameEvents(roomId);
  rooms.delete(roomId);
  return { ok: true };
}

export function setPlayerConnected(roomId: string, playerId: string, connected: boolean): void {
  const room = rooms.get(roomId);
  const p = room?.players.get(playerId);
  if (p) p.connected = connected;
}

/** Vitest / dev: clear memory and room event caches. */
export function __testClearAllLiveRooms(): void {
  for (const id of rooms.keys()) clearRoomGameEvents(id);
  rooms.clear();
}

/** Vitest: deterministic hands and timeline after startGame. */
export const liveRoomTestHelpers = {
  setPlayerHand(roomId: string, playerId: string, eventIds: string[]): void {
    const room = rooms.get(roomId);
    if (!room) throw new Error("room not found");
    room.hands.set(playerId, [...eventIds]);
  },

  setTimelineEventIds(roomId: string, eventIds: string[]): void {
    const room = rooms.get(roomId);
    if (!room) throw new Error("room not found");
    const placedAt = new Date().toISOString();
    room.timeline = eventIds.map((eventId, position) => ({
      eventId,
      position,
      placedByPlayerId: null,
      placedAt: position === 0 ? placedAt : placedAt,
    }));
    room.initialEventId = eventIds[0] ?? null;
  },

  setTurnOrder(roomId: string, orderedPlayerIds: string[], turnIndex: number): void {
    const room = rooms.get(roomId);
    if (!room) throw new Error("room not found");
    for (let i = 0; i < orderedPlayerIds.length; i++) {
      const pl = room.players.get(orderedPlayerIds[i]!);
      if (pl) pl.turnOrder = i;
    }
    room.turnIndex = turnIndex;
  },

  setPlayerStreak(roomId: string, playerId: string, streak: number): void {
    const room = rooms.get(roomId);
    if (!room) throw new Error("room not found");
    const pl = room.players.get(playerId);
    if (!pl) throw new Error("player not found");
    pl.streak = streak;
  },

  setAllPlayerStreaks(roomId: string, streak: number): void {
    const room = rooms.get(roomId);
    if (!room) throw new Error("room not found");
    for (const p of room.players.values()) p.streak = streak;
  },

  forceMatchEnded(roomId: string, winnerPlayerId: string | null): void {
    const room = rooms.get(roomId);
    if (!room) throw new Error("room not found");
    endMatchInRoom(room, winnerPlayerId, new Date().toISOString());
  },
};
