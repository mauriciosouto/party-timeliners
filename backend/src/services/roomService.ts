import { randomUUID } from "node:crypto";
import type {
  ApiEvent,
  ApiTimelineEntry,
  LastPlacedEvent,
  PlaceResult,
  RoomState,
  RoomPlayerState,
} from "../types.js";
import type { EventRecord } from "../types.js";
import type { PoolClient } from "pg";
import {
  exec,
  execClient,
  queryOne,
  queryOneClient,
  queryRows,
  queryRowsClient,
  rowCount,
  withTransaction,
} from "../db/index.js";
import { buildDeck, shuffle } from "../game/deck.js";
import { validatePlace, getNextTurnPlayerId } from "../game/validation.js";

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

function eventToEventLike(e: EventRecord): EventRecord & { wikipediaUrl?: string | null } {
  return { ...e, wikipediaUrl: e.wikipedia_url };
}

const DEFAULT_MAX_TIMELINE_SIZE = 50;
const DEFAULT_POINTS_TO_WIN = 2;
const DEFAULT_TURN_TIME_LIMIT_SECONDS = 60;

/** Shift timeline positions by +1 from fromPosition onward. Two-step update avoids UNIQUE (room_id, position) violation. */
async function shiftTimelinePositions(
  client: PoolClient,
  roomId: string,
  fromPosition: number,
): Promise<void> {
  const OFFSET = 100000;
  await execClient(
    client,
    `UPDATE room_timeline SET position = position + ? WHERE room_id = ? AND position >= ?`,
    [OFFSET, roomId, fromPosition],
  );
  await execClient(
    client,
    `UPDATE room_timeline SET position = position - ? + ? WHERE room_id = ? AND position >= ?`,
    [OFFSET, fromPosition + 1, roomId, OFFSET],
  );
}

export type CreateRoomOptions = {
  maxTimelineSize?: number;
  pointsToWin?: number;
  turnTimeLimitSeconds?: number | null;
  avatar?: string | null;
};

/** Create a room and add the host as first player. Returns roomId and playerId. */
export async function createRoom(
  hostNickname: string,
  roomName?: string,
  options?: CreateRoomOptions,
): Promise<{
  roomId: string;
  playerId: string;
  roomState: RoomState;
}> {
  const roomId = randomUUID();
  const playerId = randomUUID();

  const maxTimelineSize = options?.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE;
  const pointsToWin = options?.pointsToWin ?? DEFAULT_POINTS_TO_WIN;
  const raw = options?.turnTimeLimitSeconds;
  const turnTimeLimitSeconds =
    raw === undefined
      ? DEFAULT_TURN_TIME_LIMIT_SECONDS
      : raw === null
        ? null
        : Number(raw);
  const avatar = options?.avatar ?? null;

  await withTransaction(async (client) => {
    await execClient(
      client,
      `INSERT INTO rooms (id, name, status, host_player_id, max_timeline_size, points_to_win, turn_time_limit_seconds)
       VALUES (?, ?, 'lobby', ?, ?, ?, ?)`,
      [roomId, roomName ?? "Party Timeliners", playerId, maxTimelineSize, pointsToWin, turnTimeLimitSeconds],
    );

    await execClient(
      client,
      `INSERT INTO room_players (room_id, player_id, nickname, avatar, is_host, connected)
       VALUES (?, ?, ?, ?, 1, 1)`,
      [roomId, playerId, hostNickname, avatar],
    );
  });

  const roomState = (await getRoomState(roomId))!;
  return { roomId, playerId, roomState };
}

/** Add a player to a room (lobby only). Returns playerId and roomState. */
export async function joinRoom(
  roomId: string,
  nickname: string,
  email?: string,
  avatar?: string | null,
): Promise<{ playerId: string; roomState: RoomState } | { error: string }> {
  const room = await queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM rooms WHERE id = ?",
    [roomId],
  );

  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "Game already started" };

  const playerId = randomUUID();
  try {
    await exec(
      `INSERT INTO room_players (room_id, player_id, nickname, avatar, email, is_host, connected)
       VALUES (?, ?, ?, ?, ?, 0, 1)`,
      [roomId, playerId, nickname, avatar ?? null, email ?? null],
    );
  } catch {
    return { error: "Failed to join room" };
  }

  const roomState = (await getRoomState(roomId))!;
  return { playerId, roomState };
}

const CARDS_PER_HAND = 3;
const DRAW_POOL_SIZE = 150;

/** Build full RoomState from DB. Optionally pass forPlayerId to include that player's hand (private). */
export async function getRoomState(roomId: string, forPlayerId?: string): Promise<RoomState | null> {
  const room = await queryOne<{
    id: string;
    name: string;
    status: string;
    host_player_id: string | null;
    initial_event_id: string | null;
    next_deck_sequence: number;
    turn_index: number;
    turn_started_at: string | null;
    max_timeline_size: number | null;
    points_to_win: number | null;
    turn_time_limit_seconds: number | null;
    started_at: string | null;
    ended_at: string | null;
    winner_player_id: string | null;
  }>(
    `SELECT id, name, status, host_player_id, initial_event_id, next_deck_sequence,
            turn_index, turn_started_at, max_timeline_size, points_to_win, turn_time_limit_seconds,
            started_at, ended_at, winner_player_id
     FROM rooms WHERE id = ?`,
    [roomId],
  );

  if (!room) return null;

  const playerRows = await queryRows<{
    player_id: string;
    nickname: string;
    avatar: string | null;
    is_host: number;
    turn_order: number | null;
    score: number;
    connected: number;
    joined_at: string;
  }>(
    `SELECT player_id, nickname, avatar, is_host, turn_order, score, connected, joined_at
     FROM room_players WHERE room_id = ? ORDER BY joined_at`,
    [roomId],
  );

  const players: RoomPlayerState[] = playerRows.map((p) => ({
    playerId: p.player_id,
    nickname: p.nickname,
    avatar: p.avatar ?? undefined,
    isHost: p.is_host === 1,
    score: p.score,
    turnOrder: p.turn_order,
    connected: p.connected === 1,
    joinedAt: p.joined_at,
  }));

  const scores: Record<string, number> = {};
  playerRows.forEach((p) => (scores[p.player_id] = p.score));

  const timelineRows = await queryRows<
    EventRecord & {
      position: number;
      placed_by_player_id: string | null;
      placed_at: string;
    }
  >(
    `SELECT e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url,
            rt.position, rt.placed_by_player_id, rt.placed_at
     FROM room_timeline rt
     JOIN events e ON e.id = rt.event_id
     WHERE rt.room_id = ?
     ORDER BY rt.position`,
    [roomId],
  );

  const timeline: ApiTimelineEntry[] = timelineRows.map((r) => ({
    event: eventToApi(r),
    position: r.position,
    placedByPlayerId: r.placed_by_player_id,
    placedAt: r.placed_at,
  }));

  const lastPlacedEntry = timeline
    .filter((e) => e.placedByPlayerId != null && e.placedAt != null)
    .sort(
      (a, b) =>
        new Date(b.placedAt!).getTime() - new Date(a.placedAt!).getTime(),
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

  if (room.status === "playing" && playerRows.length > 0) {
    const ordered = [...playerRows].sort(
      (a, b) => (a.turn_order ?? 999) - (b.turn_order ?? 999),
    );
    turnOrder = ordered.map((p) => p.player_id);
    currentTurnPlayerId = turnOrder[room.turn_index] ?? null;
    const raw = room.turn_started_at ?? room.started_at;
    currentTurnStartedAt =
      raw && typeof raw === "string" && raw.length === 19 && !raw.endsWith("Z")
        ? `${raw}Z`
        : raw;
    if (forPlayerId) {
      const handRows = await queryRows<EventRecord>(
        `SELECT e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url
         FROM room_hand rh JOIN events e ON e.id = rh.event_id
         WHERE rh.room_id = ? AND rh.player_id = ? ORDER BY rh.slot_index`,
        [roomId, forPlayerId],
      );
      myHand = handRows.map(eventToApi);
    }
  }

  return {
    roomId: room.id,
    name: room.name,
    status: room.status as "lobby" | "playing" | "ended",
    hostPlayerId: room.host_player_id,
    maxTimelineSize: room.max_timeline_size,
    pointsToWin: room.points_to_win,
    turnTimeLimitSeconds: room.turn_time_limit_seconds,
    players,
    timeline,
    scores,
    turnOrder,
    currentTurnPlayerId,
    currentTurnStartedAt,
    myHand,
    nextDeckSequence: room.next_deck_sequence,
    initialEventId: room.initial_event_id,
    endedAt: room.ended_at,
    winnerPlayerId: room.winner_player_id,
    lastPlacedEvent,
  };
}

/** Start the game (host only, lobby only). Builds deck, assigns turn order, puts first event on timeline. */
export async function startGame(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  const room = await queryOne<{ id: string; status: string; host_player_id: string }>(
    "SELECT id, status, host_player_id FROM rooms WHERE id = ?",
    [roomId],
  );

  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "Game already started" };
  if (room.host_player_id !== playerId) return { error: "Only host can start" };

  const playerCount = rowCount(
    await queryOne<{ c: unknown }>("SELECT COUNT(*)::int AS c FROM room_players WHERE room_id = ?", [
      roomId,
    ]),
    "c",
  );
  const connectedCount = rowCount(
    await queryOne<{ c: unknown }>(
      "SELECT COUNT(*)::int AS c FROM room_players WHERE room_id = ? AND connected = 1",
      [roomId],
    ),
    "c",
  );
  if (playerCount < 2 || connectedCount < 2)
    return { error: "At least 2 players are required to start. Wait for another player to join." };

  const events = await queryRows<EventRecord>("SELECT * FROM events", []);
  const playerIds = await queryRows<{ player_id: string }>(
    "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY joined_at",
    [roomId],
  );
  const N = playerIds.length;
  const totalCardsNeeded = 1 + CARDS_PER_HAND * N + DRAW_POOL_SIZE;
  if (events.length < totalCardsNeeded) {
    return { error: "Not enough events in pool. Run seed first." };
  }

  const fullDeck = buildDeck(events.map(eventToEventLike), totalCardsNeeded);
  const initialEvent = fullDeck[0] as EventRecord | undefined;
  const handEvents = fullDeck.slice(1, 1 + CARDS_PER_HAND * N);
  const drawEvents = fullDeck.slice(1 + CARDS_PER_HAND * N);
  if (!initialEvent) return { error: "Failed to build deck" };

  const turnOrderShuffle = shuffle(playerIds.map((p) => p.player_id));
  const nowIso = new Date().toISOString();

  await withTransaction(async (client) => {
    await execClient(
      client,
      `UPDATE rooms SET status = 'playing', initial_event_id = ?, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = ?, started_at = ? WHERE id = ?`,
      [initialEvent.id, nowIso, nowIso, roomId],
    );

    await execClient(
      client,
      `INSERT INTO room_timeline (room_id, event_id, position, placed_at) VALUES (?, ?, 0, ?)`,
      [roomId, initialEvent.id, nowIso],
    );

    for (let i = 0; i < turnOrderShuffle.length; i++) {
      const pid = turnOrderShuffle[i]!;
      await execClient(
        client,
        "UPDATE room_players SET turn_order = ?, score = 0 WHERE room_id = ? AND player_id = ?",
        [i, roomId, pid],
      );
    }

    for (let playerIndex = 0; playerIndex < turnOrderShuffle.length; playerIndex++) {
      const pid = turnOrderShuffle[playerIndex]!;
      for (let s = 0; s < CARDS_PER_HAND; s++) {
        const ev = handEvents[playerIndex * CARDS_PER_HAND + s];
        if (ev)
          await execClient(
            client,
            "INSERT INTO room_hand (room_id, player_id, event_id, slot_index) VALUES (?, ?, ?, ?)",
            [roomId, pid, ev.id, s],
          );
      }
    }

    for (let i = 0; i < drawEvents.length; i++) {
      const e = drawEvents[i]!;
      await execClient(
        client,
        "INSERT INTO room_deck (room_id, event_id, sequence) VALUES (?, ?, ?)",
        [roomId, e.id, i],
      );
    }
  });

  return (await getRoomState(roomId, turnOrderShuffle[0] ?? undefined))!;
}

/** Get the first card in the current turn player's hand (for backward compatibility). */
export async function getNextEventForCurrentTurn(
  roomId: string,
  playerId: string,
): Promise<ApiEvent | null> {
  const state = await getRoomState(roomId, playerId);
  if (!state || state.status !== "playing" || state.myHand.length === 0) return null;
  if (state.currentTurnPlayerId !== playerId) return null;
  return state.myHand[0] ?? null;
}

/** Remove one card from player's hand and draw one from deck into hand. Used after place/timeout. */
async function removeFromHandAndDraw(
  client: PoolClient,
  roomId: string,
  playerId: string,
  eventId: string,
): Promise<void> {
  await execClient(
    client,
    "DELETE FROM room_hand WHERE room_id = ? AND player_id = ? AND event_id = ?",
    [roomId, playerId, eventId],
  );

  const drawRow = await queryOneClient<{ event_id: string; sequence: number }>(
    client,
    `SELECT event_id, sequence FROM room_deck WHERE room_id = ? ORDER BY sequence ASC LIMIT 1`,
    [roomId],
  );
  if (!drawRow) return;

  await execClient(
    client,
    "DELETE FROM room_deck WHERE room_id = ? AND event_id = ? AND sequence = ?",
    [roomId, drawRow.event_id, drawRow.sequence],
  );

  const usedSlots = await queryRowsClient<{ slot_index: number }>(
    client,
    "SELECT slot_index FROM room_hand WHERE room_id = ? AND player_id = ?",
    [roomId, playerId],
  );
  const used = new Set(usedSlots.map((r) => r.slot_index));
  const freeSlot = [0, 1, 2].find((s) => !used.has(s)) ?? 0;
  await execClient(
    client,
    "INSERT INTO room_hand (room_id, player_id, event_id, slot_index) VALUES (?, ?, ?, ?)",
    [roomId, playerId, drawRow.event_id, freeSlot],
  );
}

/** Place event (current turn player only). Same validation as before; score is per-player. */
export async function placeEvent(
  roomId: string,
  playerId: string,
  eventId: string,
  position: number,
): Promise<PlaceResult | { error: string }> {
  const room = await queryOne<{
    id: string;
    status: string;
    next_deck_sequence: number;
    turn_index: number;
    max_timeline_size: number | null;
    points_to_win: number | null;
  }>(
    "SELECT id, status, next_deck_sequence, turn_index, max_timeline_size, points_to_win FROM rooms WHERE id = ?",
    [roomId],
  );

  if (!room || room.status !== "playing") {
    return { error: "Room not found or not playing" };
  }

  const turnOrderRows = await queryRows<{ player_id: string }>(
    "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order",
    [roomId],
  );
  const turnOrder = turnOrderRows.map((r) => r.player_id);
  const currentPlayerId = turnOrderRows[room.turn_index]?.player_id ?? null;

  const event = await queryOne<EventRecord>("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event) return { error: "Event not found" };

  const handRows = await queryRows<{ event_id: string }>(
    "SELECT event_id FROM room_hand WHERE room_id = ? AND player_id = ?",
    [roomId, playerId],
  );
  const handEventIds = new Set(handRows.map((r) => r.event_id));

  const timelineRows = await queryRows<{ year: number }>(
    `SELECT e.year FROM room_timeline rt
     JOIN events e ON e.id = rt.event_id WHERE rt.room_id = ? ORDER BY rt.position`,
    [roomId],
  );
  const timelineYears = timelineRows.map((r) => r.year);

  const playerScoreRow = await queryOne<{ score: number }>(
    "SELECT score FROM room_players WHERE room_id = ? AND player_id = ?",
    [roomId, playerId],
  );
  const currentPlayerScore = playerScoreRow?.score ?? 0;

  const validation = validatePlace(
    playerId,
    eventId,
    position,
    { ...event, year: event.year },
    {
      currentTurnPlayerId: currentPlayerId,
      turnOrder,
      turnIndex: room.turn_index,
      handEventIds,
      timelineYears,
      timelineLength: timelineYears.length,
      maxTimelineSize: room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE,
      pointsToWin: room.points_to_win ?? DEFAULT_POINTS_TO_WIN,
      currentPlayerScore,
    },
  );

  if (!validation.valid) return { error: validation.error };

  const { correct, correctPosition } = validation;
  const playerScore = { score: currentPlayerScore };
  const numPlayers = turnOrderRows.length;
  const nextTurnIndex = (room.turn_index + 1) % numPlayers;
  const nextTurnPlayerId = getNextTurnPlayerId(turnOrder, room.turn_index);

  if (!correct) {
    const nowIso = new Date().toISOString();
    await withTransaction(async (client) => {
      await removeFromHandAndDraw(client, roomId, playerId, eventId);
      await shiftTimelinePositions(client, roomId, correctPosition);
      await execClient(
        client,
        `INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
         VALUES (?, ?, ?, ?, ?)`,
        [roomId, eventId, correctPosition, playerId, nowIso],
      );
      await execClient(client, `UPDATE rooms SET turn_index = ?, turn_started_at = ? WHERE id = ?`, [
        nextTurnIndex,
        nowIso,
        roomId,
      ]);
    });

    const state = await getRoomState(roomId);
    if (!state) {
      return { error: "Room state unavailable" };
    }
    const newTimelineLength = state.timeline.length;
    const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
    const gameEndsByTimeline = newTimelineLength >= maxTimelineSize;

    if (gameEndsByTimeline) {
      const winnerRows = await queryRows<{ player_id: string; score: number }>(
        "SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC",
        [roomId],
      );
      const maxScore = winnerRows[0]?.score ?? 0;
      const winnerPlayerId =
        winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
      await exec(
        `UPDATE rooms SET status = 'ended', ended_at = ?, winner_player_id = ? WHERE id = ?`,
        [new Date().toISOString(), winnerPlayerId, roomId],
      );
      const finalState = (await getRoomState(roomId))!;
      return {
        correct: false,
        gameEnded: true,
        correctPosition,
        score: playerScore.score,
        timeline: finalState.timeline,
        nextTurnPlayerId: null,
      };
    }

    return {
      correct: false,
      gameEnded: false,
      correctPosition,
      score: playerScore.score,
      timeline: state.timeline,
      nextTurnPlayerId,
    };
  }

  const newTimelineLength = timelineYears.length + 1;
  const newScore = playerScore.score + 1;
  const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
  const pointsToWin = room.points_to_win ?? DEFAULT_POINTS_TO_WIN;
  const gameEndsByTimeline = newTimelineLength >= maxTimelineSize;
  const gameEndsByScore = newScore >= pointsToWin;

  const nowIsoCorrect = new Date().toISOString();
  await withTransaction(async (client) => {
    await removeFromHandAndDraw(client, roomId, playerId, eventId);
    await shiftTimelinePositions(client, roomId, position);
    await execClient(
      client,
      `INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [roomId, eventId, position, playerId, nowIsoCorrect],
    );
    await execClient(
      client,
      "UPDATE room_players SET score = score + 1 WHERE room_id = ? AND player_id = ?",
      [roomId, playerId],
    );
    await execClient(client, `UPDATE rooms SET turn_index = ?, turn_started_at = ? WHERE id = ?`, [
      nextTurnIndex,
      nowIsoCorrect,
      roomId,
    ]);
  });

  let state = (await getRoomState(roomId))!;
  if (gameEndsByTimeline || gameEndsByScore) {
    const winnerRows = await queryRows<{ player_id: string; score: number }>(
      "SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC",
      [roomId],
    );
    const maxScore = winnerRows[0]?.score ?? 0;
    const winnerPlayerId =
      winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
    await exec(
      `UPDATE rooms SET status = 'ended', ended_at = ?, winner_player_id = ? WHERE id = ?`,
      [new Date().toISOString(), winnerPlayerId, roomId],
    );
    state = (await getRoomState(roomId))!;
    return {
      correct: true,
      gameEnded: true,
      score: state.scores[playerId] ?? 0,
      timeline: state.timeline,
      nextTurnPlayerId: null,
    };
  }

  return {
    correct: true,
    score: state.scores[playerId] ?? 0,
    timeline: state.timeline,
    nextTurnPlayerId,
  };
}

/** Turn timeout: current player didn't place in time. Event is placed at correct position on timeline (no point). */
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
  const room = await queryOne<{
    id: string;
    status: string;
    turn_index: number;
    next_deck_sequence: number;
    turn_time_limit_seconds: number | null;
    max_timeline_size: number | null;
  }>(
    "SELECT id, status, turn_index, next_deck_sequence, turn_time_limit_seconds, max_timeline_size FROM rooms WHERE id = ?",
    [roomId],
  );

  if (!room || room.status !== "playing") {
    return { error: "Room not found or not playing" };
  }
  if (room.turn_time_limit_seconds == null) {
    return { error: "No turn time limit set" };
  }

  const turnOrderRows = await queryRows<{ player_id: string }>(
    "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order",
    [roomId],
  );
  const currentPlayerId = turnOrderRows[room.turn_index]?.player_id;
  if (currentPlayerId !== playerId) return { error: "Not your turn" };

  const handRow = await queryOne<{ event_id: string }>(
    `SELECT rh.event_id FROM room_hand rh WHERE rh.room_id = ? AND rh.player_id = ? ORDER BY rh.slot_index LIMIT 1`,
    [roomId, playerId],
  );
  if (!handRow) {
    return { error: "No card in hand for this turn" };
  }
  const eventId = handRow.event_id;

  const event = await queryOne<EventRecord>("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event) return { error: "Event not found" };

  const timelineRows = await queryRows<{ year: number; position: number }>(
    `SELECT e.year, rt.position FROM room_timeline rt
     JOIN events e ON e.id = rt.event_id WHERE rt.room_id = ? ORDER BY rt.position`,
    [roomId],
  );

  const correctIndex = timelineRows.findIndex((r) => r.year > event.year);
  const correctPosition = correctIndex === -1 ? timelineRows.length : correctIndex;
  const numPlayers = turnOrderRows.length;
  const nextTurnIndex = (room.turn_index + 1) % numPlayers;
  const nextTurnPlayerId = turnOrderRows[nextTurnIndex]?.player_id ?? null;

  const nowIsoT = new Date().toISOString();
  await withTransaction(async (client) => {
    await removeFromHandAndDraw(client, roomId, playerId, eventId);
    await shiftTimelinePositions(client, roomId, correctPosition);
    await execClient(
      client,
      `INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [roomId, eventId, correctPosition, playerId, nowIsoT],
    );
    await execClient(client, `UPDATE rooms SET turn_index = ?, turn_started_at = ? WHERE id = ?`, [
      nextTurnIndex,
      nowIsoT,
      roomId,
    ]);
  });

  let state = (await getRoomState(roomId))!;
  const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
  const gameEndsByTimeline = state.timeline.length >= maxTimelineSize;

  if (gameEndsByTimeline) {
    const winnerRows = await queryRows<{ player_id: string; score: number }>(
      "SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC",
      [roomId],
    );
    const maxScore = winnerRows[0]?.score ?? 0;
    const winnerPlayerId =
      winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
    await exec(
      `UPDATE rooms SET status = 'ended', ended_at = ?, winner_player_id = ? WHERE id = ?`,
      [new Date().toISOString(), winnerPlayerId, roomId],
    );
    state = (await getRoomState(roomId))!;
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

/** End the game now. Host only, room must be playing. No winner — room returns to lobby so everyone can start a new game. */
export async function endGame(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  const room = await queryOne<{ id: string; status: string; host_player_id: string | null }>(
    "SELECT id, status, host_player_id FROM rooms WHERE id = ?",
    [roomId],
  );

  if (!room) return { error: "Room not found" };
  if (room.status !== "playing") return { error: "Game is not in progress" };
  if (room.host_player_id !== playerId) return { error: "Only the host can end the game" };

  await withTransaction(async (client) => {
    await execClient(client, "DELETE FROM room_timeline WHERE room_id = ?", [roomId]);
    await execClient(client, "DELETE FROM room_deck WHERE room_id = ?", [roomId]);
    await execClient(client, "DELETE FROM room_hand WHERE room_id = ?", [roomId]);
    await execClient(
      client,
      `UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
       WHERE id = ?`,
      [roomId],
    );
    await execClient(client, "UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?", [
      roomId,
    ]);
  });

  return (await getRoomState(roomId))!;
}

/** Rematch: reset room to lobby so the host can start a new game. Host only, room must be ended. */
export async function rematchRoom(
  roomId: string,
  playerId: string,
): Promise<RoomState | { error: string }> {
  const room = await queryOne<{ id: string; status: string; host_player_id: string | null }>(
    "SELECT id, status, host_player_id FROM rooms WHERE id = ?",
    [roomId],
  );

  if (!room) return { error: "Room not found" };
  if (room.status !== "ended") return { error: "Game is not finished" };
  if (room.host_player_id !== playerId) return { error: "Only the host can start a revanche" };

  const playerCount = rowCount(
    await queryOne<{ c: unknown }>("SELECT COUNT(*)::int AS c FROM room_players WHERE room_id = ?", [
      roomId,
    ]),
    "c",
  );
  const connectedCount = rowCount(
    await queryOne<{ c: unknown }>(
      "SELECT COUNT(*)::int AS c FROM room_players WHERE room_id = ? AND connected = 1",
      [roomId],
    ),
    "c",
  );
  if (playerCount < 2 || connectedCount < 2)
    return {
      error:
        "At least 2 players are required for a rematch. Wait for another player to join.",
    };

  await withTransaction(async (client) => {
    await execClient(client, "DELETE FROM room_timeline WHERE room_id = ?", [roomId]);
    await execClient(client, "DELETE FROM room_deck WHERE room_id = ?", [roomId]);
    await execClient(client, "DELETE FROM room_hand WHERE room_id = ?", [roomId]);
    await execClient(
      client,
      `UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
       WHERE id = ?`,
      [roomId],
    );
    await execClient(client, "UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?", [
      roomId,
    ]);
  });

  return (await getRoomState(roomId))!;
}

/** Leave room (non-host only). In lobby: just remove player. In playing: remove player, keep timeline; if it was their turn, advance to next without placing a card. Returns new state and left player nickname for notification, or error. */
export async function leaveRoom(
  roomId: string,
  playerId: string,
): Promise<{ roomState: RoomState; leftPlayerNickname: string } | { error: string }> {
  const room = await queryOne<{
    id: string;
    status: string;
    host_player_id: string | null;
    turn_index: number;
  }>("SELECT id, status, host_player_id, turn_index FROM rooms WHERE id = ?", [roomId]);

  if (!room) return { error: "Room not found" };
  if (room.host_player_id === playerId) {
    return { error: "Host cannot leave; use End game to return to lobby" };
  }

  const playerRow = await queryOne<{ player_id: string; nickname: string }>(
    "SELECT player_id, nickname FROM room_players WHERE room_id = ? AND player_id = ?",
    [roomId, playerId],
  );
  if (!playerRow) return { error: "Player not in room" };
  const leftPlayerNickname = playerRow.nickname;

  if (room.status === "lobby") {
    await exec("DELETE FROM room_players WHERE room_id = ? AND player_id = ?", [roomId, playerId]);
    const roomState = await getRoomState(roomId);
    return {
      roomState: roomState!,
      leftPlayerNickname,
    };
  }

  if (room.status !== "playing") {
    return { error: "Room is not in lobby or playing" };
  }

  const turnOrderedRows = await queryRows<{ player_id: string }>(
    "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order ASC",
    [roomId],
  );
  const orderedIds = turnOrderedRows.map((r) => r.player_id);
  const leavingIndex = orderedIds.indexOf(playerId);
  if (leavingIndex === -1) return { error: "Player not in room" };

  const currentTurnPlayerId = orderedIds[room.turn_index] ?? null;
  const wasCurrentTurn = currentTurnPlayerId === playerId;
  const newOrderedIds = orderedIds.filter((id) => id !== playerId);

  let newTurnIndexResolved: number | undefined;
  if (newOrderedIds.length >= 2) {
    const nextPlayerId = wasCurrentTurn
      ? orderedIds[(room.turn_index + 1) % orderedIds.length]
      : currentTurnPlayerId;
    const idx = newOrderedIds.indexOf(nextPlayerId!);
    if (idx === -1) return { error: "Could not update turn order after player left" };
    newTurnIndexResolved = idx;
  }

  await withTransaction(async (client) => {
    await execClient(client, "DELETE FROM room_hand WHERE room_id = ? AND player_id = ?", [
      roomId,
      playerId,
    ]);
    await execClient(client, "DELETE FROM room_players WHERE room_id = ? AND player_id = ?", [
      roomId,
      playerId,
    ]);

    if (newOrderedIds.length < 2) {
      await execClient(client, "DELETE FROM room_timeline WHERE room_id = ?", [roomId]);
      await execClient(client, "DELETE FROM room_deck WHERE room_id = ?", [roomId]);
      await execClient(client, "DELETE FROM room_hand WHERE room_id = ?", [roomId]);
      await execClient(
        client,
        `UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
         turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
         WHERE id = ?`,
        [roomId],
      );
      await execClient(client, "UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?", [
        roomId,
      ]);
    } else {
      for (let i = 0; i < newOrderedIds.length; i++) {
        await execClient(
          client,
          "UPDATE room_players SET turn_order = ? WHERE room_id = ? AND player_id = ?",
          [i, roomId, newOrderedIds[i]],
        );
      }
      await execClient(client, `UPDATE rooms SET turn_index = ?, turn_started_at = ? WHERE id = ?`, [
        newTurnIndexResolved!,
        new Date().toISOString(),
        roomId,
      ]);
    }
  });

  const roomState = await getRoomState(roomId, newOrderedIds[0]);
  return { roomState: roomState!, leftPlayerNickname };
}

/** Permanently close a room (host only). Deletes the room and all related data. Everyone must be redirected by the caller (broadcast room_closed). */
export async function closeRoomPermanently(
  roomId: string,
  playerId: string,
): Promise<{ ok: true } | { error: string }> {
  const room = await queryOne<{ id: string; host_player_id: string | null }>(
    "SELECT id, host_player_id FROM rooms WHERE id = ?",
    [roomId],
  );
  if (!room) return { error: "Room not found" };
  if (room.host_player_id !== playerId) return { error: "Only the host can close the room" };
  await exec("DELETE FROM rooms WHERE id = ?", [roomId]);
  return { ok: true };
}

/** Mark player as disconnected (for WebSocket close). */
export async function setPlayerConnected(
  roomId: string,
  playerId: string,
  connected: boolean,
): Promise<void> {
  await exec("UPDATE room_players SET connected = ? WHERE room_id = ? AND player_id = ?", [
    connected ? 1 : 0,
    roomId,
    playerId,
  ]);
}
