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
import { getDb } from "../db/index.js";
import { buildDeck, shuffle } from "../game/deck.js";
import { validatePlace, getNextTurnPlayerId } from "../game/validation.js";

const INITIAL_DECK_SIZE = 200;

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

/** Shift timeline positions by +1 from fromPosition onward. Uses a two-step update to avoid UNIQUE (room_id, position) violation in SQLite. */
function shiftTimelinePositions(
  db: ReturnType<typeof getDb>,
  roomId: string,
  fromPosition: number,
): void {
  const OFFSET = 100000;
  db.prepare(
    `UPDATE room_timeline SET position = position + ? WHERE room_id = ? AND position >= ?`,
  ).run(OFFSET, roomId, fromPosition);
  db.prepare(
    `UPDATE room_timeline SET position = position - ? + ? WHERE room_id = ? AND position >= ?`,
  ).run(OFFSET, fromPosition + 1, roomId, OFFSET);
}

export type CreateRoomOptions = {
  maxTimelineSize?: number;
  pointsToWin?: number;
  turnTimeLimitSeconds?: number | null;
  avatar?: string | null;
};

/** Create a room and add the host as first player. Returns roomId and playerId. */
export function createRoom(
  hostNickname: string,
  roomName?: string,
  options?: CreateRoomOptions,
): {
  roomId: string;
  playerId: string;
  roomState: RoomState;
} {
  const db = getDb();
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

  db.transaction(() => {
    db.prepare(
      `INSERT INTO rooms (id, name, status, host_player_id, max_timeline_size, points_to_win, turn_time_limit_seconds)
       VALUES (?, ?, 'lobby', ?, ?, ?, ?)`,
    ).run(
      roomId,
      roomName ?? "Party Timeliners",
      playerId,
      maxTimelineSize,
      pointsToWin,
      turnTimeLimitSeconds,
    );

    db.prepare(
      `INSERT INTO room_players (room_id, player_id, nickname, avatar, is_host, connected)
       VALUES (?, ?, ?, ?, 1, 1)`,
    ).run(roomId, playerId, hostNickname, avatar);
  })();

  const roomState = getRoomState(roomId)!;
  return { roomId, playerId, roomState };
}

/** Add a player to a room (lobby only). Returns playerId and roomState. */
export function joinRoom(
  roomId: string,
  nickname: string,
  email?: string,
  avatar?: string | null,
): { playerId: string; roomState: RoomState } | { error: string } {
  const db = getDb();

  const room = db
    .prepare("SELECT id, status FROM rooms WHERE id = ?")
    .get(roomId) as { id: string; status: string } | undefined;

  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "Game already started" };

  const playerId = randomUUID();
  try {
    db.prepare(
      `INSERT INTO room_players (room_id, player_id, nickname, avatar, email, is_host, connected)
       VALUES (?, ?, ?, ?, ?, 0, 1)`,
    ).run(roomId, playerId, nickname, avatar ?? null, email ?? null);
  } catch {
    return { error: "Failed to join room" };
  }

  const roomState = getRoomState(roomId)!;
  return { playerId, roomState };
}

const CARDS_PER_HAND = 3;
const DRAW_POOL_SIZE = 150;

/** Build full RoomState from DB. Optionally pass forPlayerId to include that player's hand (private). */
export function getRoomState(roomId: string, forPlayerId?: string): RoomState | null {
  const db = getDb();

  const room = db
    .prepare(
      `SELECT id, name, status, host_player_id, initial_event_id, next_deck_sequence,
              turn_index, turn_started_at, max_timeline_size, points_to_win, turn_time_limit_seconds,
              started_at, ended_at, winner_player_id
       FROM rooms WHERE id = ?`,
    )
    .get(roomId) as {
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
    } | undefined;

  if (!room) return null;

  const playerRows = db
    .prepare(
      `SELECT player_id, nickname, avatar, is_host, turn_order, score, connected, joined_at
       FROM room_players WHERE room_id = ? ORDER BY joined_at`,
    )
    .all(roomId) as {
      player_id: string;
      nickname: string;
      avatar: string | null;
      is_host: number;
      turn_order: number | null;
      score: number;
      connected: number;
      joined_at: string;
    }[];

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

  const timelineRows = db
    .prepare(
      `SELECT e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url,
              rt.position, rt.placed_by_player_id, rt.placed_at
       FROM room_timeline rt
       JOIN events e ON e.id = rt.event_id
       WHERE rt.room_id = ?
       ORDER BY rt.position`,
    )
    .all(roomId) as (EventRecord & {
      position: number;
      placed_by_player_id: string | null;
      placed_at: string;
    })[];

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
      const handRows = db
        .prepare(
          `SELECT e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url
           FROM room_hand rh JOIN events e ON e.id = rh.event_id
           WHERE rh.room_id = ? AND rh.player_id = ? ORDER BY rh.slot_index`,
        )
        .all(roomId, forPlayerId) as EventRecord[];
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
export function startGame(roomId: string, playerId: string): RoomState | { error: string } {
  const db = getDb();

  const room = db
    .prepare("SELECT id, status, host_player_id FROM rooms WHERE id = ?")
    .get(roomId) as { id: string; status: string; host_player_id: string } | undefined;

  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "Game already started" };
  if (room.host_player_id !== playerId) return { error: "Only host can start" };

  const playerCount = db
    .prepare("SELECT COUNT(*) as c FROM room_players WHERE room_id = ?")
    .get(roomId) as { c: number };
  const connectedCount = db
    .prepare("SELECT COUNT(*) as c FROM room_players WHERE room_id = ? AND connected = 1")
    .get(roomId) as { c: number };
  if (playerCount.c < 2 || connectedCount.c < 2)
    return { error: "At least 2 players are required to start. Wait for another player to join." };

  const events = db.prepare("SELECT * FROM events").all() as EventRecord[];
  const playerIds = db
    .prepare("SELECT player_id FROM room_players WHERE room_id = ? ORDER BY joined_at")
    .all(roomId) as { player_id: string }[];
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

  db.transaction(() => {
    db.prepare(
      `UPDATE rooms SET status = 'playing', initial_event_id = ?, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = datetime('now'), started_at = datetime('now') WHERE id = ?`,
    ).run(initialEvent.id, roomId);

    db.prepare(
      `INSERT INTO room_timeline (room_id, event_id, position, placed_at) VALUES (?, ?, 0, datetime('now'))`,
    ).run(roomId, initialEvent.id);

    turnOrderShuffle.forEach((pid: string, i: number) => {
      db.prepare(
        "UPDATE room_players SET turn_order = ?, score = 0 WHERE room_id = ? AND player_id = ?",
      ).run(i, roomId, pid);
    });

    const insertHand = db.prepare(
      "INSERT INTO room_hand (room_id, player_id, event_id, slot_index) VALUES (?, ?, ?, ?)",
    );
    turnOrderShuffle.forEach((pid: string, playerIndex: number) => {
      for (let s = 0; s < CARDS_PER_HAND; s++) {
        const ev = handEvents[playerIndex * CARDS_PER_HAND + s];
        if (ev) insertHand.run(roomId, pid, ev.id, s);
      }
    });

    const insertDeck = db.prepare(
      "INSERT INTO room_deck (room_id, event_id, sequence) VALUES (?, ?, ?)",
    );
    drawEvents.forEach((e, i) => insertDeck.run(roomId, e.id, i));
  })();

  return getRoomState(roomId, turnOrderShuffle[0] ?? undefined)!;
}

/** Get the first card in the current turn player's hand (for backward compatibility). */
export function getNextEventForCurrentTurn(
  roomId: string,
  playerId: string,
): ApiEvent | null {
  const state = getRoomState(roomId, playerId);
  if (!state || state.status !== "playing" || state.myHand.length === 0) return null;
  if (state.currentTurnPlayerId !== playerId) return null;
  return state.myHand[0] ?? null;
}

/** Remove one card from player's hand and draw one from deck into hand. Used after place/timeout. */
function removeFromHandAndDraw(
  db: ReturnType<typeof getDb>,
  roomId: string,
  playerId: string,
  eventId: string,
): void {
  db.prepare(
    "DELETE FROM room_hand WHERE room_id = ? AND player_id = ? AND event_id = ?",
  ).run(roomId, playerId, eventId);

  const drawRow = db
    .prepare(
      `SELECT event_id, sequence FROM room_deck WHERE room_id = ? ORDER BY sequence ASC LIMIT 1`,
    )
    .get(roomId) as { event_id: string; sequence: number } | undefined;
  if (!drawRow) return;

  db.prepare(
    "DELETE FROM room_deck WHERE room_id = ? AND event_id = ? AND sequence = ?",
  ).run(roomId, drawRow.event_id, drawRow.sequence);

  const usedSlots = db
    .prepare(
      "SELECT slot_index FROM room_hand WHERE room_id = ? AND player_id = ?",
    )
    .all(roomId, playerId) as { slot_index: number }[];
  const used = new Set(usedSlots.map((r) => r.slot_index));
  const freeSlot = [0, 1, 2].find((s) => !used.has(s)) ?? 0;
  db.prepare(
    "INSERT INTO room_hand (room_id, player_id, event_id, slot_index) VALUES (?, ?, ?, ?)",
  ).run(roomId, playerId, drawRow.event_id, freeSlot);
}

/** Place event (current turn player only). Same validation as before; score is per-player. */
export function placeEvent(
  roomId: string,
  playerId: string,
  eventId: string,
  position: number,
): PlaceResult | { error: string } {
  const db = getDb();

  const room = db
    .prepare(
      "SELECT id, status, next_deck_sequence, turn_index, max_timeline_size, points_to_win FROM rooms WHERE id = ?",
    )
    .get(roomId) as {
      id: string;
      status: string;
      next_deck_sequence: number;
      turn_index: number;
      max_timeline_size: number | null;
      points_to_win: number | null;
    } | undefined;

  if (!room || room.status !== "playing") {
    return { error: "Room not found or not playing" };
  }

  const turnOrderRows = db
    .prepare(
      "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order",
    )
    .all(roomId) as { player_id: string }[];
  const turnOrder = turnOrderRows.map((r) => r.player_id);
  const currentPlayerId = turnOrderRows[room.turn_index]?.player_id ?? null;

  const event = db
    .prepare("SELECT * FROM events WHERE id = ?")
    .get(eventId) as EventRecord | undefined;
  if (!event) return { error: "Event not found" };

  const handRows = db
    .prepare(
      "SELECT event_id FROM room_hand WHERE room_id = ? AND player_id = ?",
    )
    .all(roomId, playerId) as { event_id: string }[];
  const handEventIds = new Set(handRows.map((r) => r.event_id));

  const timelineRows = db
    .prepare(
      `SELECT e.year FROM room_timeline rt
       JOIN events e ON e.id = rt.event_id WHERE rt.room_id = ? ORDER BY rt.position`,
    )
    .all(roomId) as { year: number }[];
  const timelineYears = timelineRows.map((r) => r.year);

  const playerScoreRow = db
    .prepare(
      "SELECT score FROM room_players WHERE room_id = ? AND player_id = ?",
    )
    .get(roomId, playerId) as { score: number } | undefined;
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
    db.transaction(() => {
      removeFromHandAndDraw(db, roomId, playerId, eventId);
      shiftTimelinePositions(db, roomId, correctPosition);
      db.prepare(
        `INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      ).run(roomId, eventId, correctPosition, playerId);
      db.prepare(
        `UPDATE rooms SET turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`,
      ).run(nextTurnIndex, roomId);
    })();

    const state = getRoomState(roomId);
    if (!state) {
      return { error: "Room state unavailable" };
    }
    const newTimelineLength = state.timeline.length;
    const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
    const gameEndsByTimeline = newTimelineLength >= maxTimelineSize;

    if (gameEndsByTimeline) {
      const winnerRows = db
        .prepare(
          "SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC",
        )
        .all(roomId) as { player_id: string; score: number }[];
      const maxScore = winnerRows[0]?.score ?? 0;
      const winnerPlayerId =
        winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
      db.prepare(
        `UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`,
      ).run(winnerPlayerId, roomId);
      const finalState = getRoomState(roomId)!;
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

  db.transaction(() => {
    removeFromHandAndDraw(db, roomId, playerId, eventId);
    shiftTimelinePositions(db, roomId, position);
    db.prepare(
      `INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(roomId, eventId, position, playerId);
    db.prepare(
      "UPDATE room_players SET score = score + 1 WHERE room_id = ? AND player_id = ?",
    ).run(roomId, playerId);
    db.prepare(
      `UPDATE rooms SET turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`,
    ).run(nextTurnIndex, roomId);
  })();

  let state = getRoomState(roomId)!;
  if (gameEndsByTimeline || gameEndsByScore) {
    const winnerRows = db
      .prepare(
        "SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC",
      )
      .all(roomId) as { player_id: string; score: number }[];
    const maxScore = winnerRows[0]?.score ?? 0;
    const winnerPlayerId =
      winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
    db.prepare(
      `UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`,
    ).run(winnerPlayerId, roomId);
    state = getRoomState(roomId)!;
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
export function timeoutTurn(
  roomId: string,
  playerId: string,
): {
  nextTurnPlayerId: string | null;
  nextEvent: ApiEvent | null;
  gameEnded?: boolean;
  timeline: ApiTimelineEntry[];
} | { error: string } {
  const db = getDb();

  const room = db
    .prepare(
      "SELECT id, status, turn_index, next_deck_sequence, turn_time_limit_seconds, max_timeline_size FROM rooms WHERE id = ?",
    )
    .get(roomId) as {
      id: string;
      status: string;
      turn_index: number;
      next_deck_sequence: number;
      turn_time_limit_seconds: number | null;
      max_timeline_size: number | null;
    } | undefined;

  if (!room || room.status !== "playing") {
    return { error: "Room not found or not playing" };
  }
  if (room.turn_time_limit_seconds == null) {
    return { error: "No turn time limit set" };
  }

  const turnOrderRows = db
    .prepare(
      "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order",
    )
    .all(roomId) as { player_id: string }[];
  const currentPlayerId = turnOrderRows[room.turn_index]?.player_id;
  if (currentPlayerId !== playerId) return { error: "Not your turn" };

  const handRow = db
    .prepare(
      `SELECT rh.event_id FROM room_hand rh WHERE rh.room_id = ? AND rh.player_id = ? ORDER BY rh.slot_index LIMIT 1`,
    )
    .get(roomId, playerId) as { event_id: string } | undefined;
  if (!handRow) {
    return { error: "No card in hand for this turn" };
  }
  const eventId = handRow.event_id;

  const event = db
    .prepare("SELECT * FROM events WHERE id = ?")
    .get(eventId) as EventRecord | undefined;
  if (!event) return { error: "Event not found" };

  const timelineRows = db
    .prepare(
      `SELECT e.year, rt.position FROM room_timeline rt
       JOIN events e ON e.id = rt.event_id WHERE rt.room_id = ? ORDER BY rt.position`,
    )
    .all(roomId) as { year: number; position: number }[];

  const correctIndex = timelineRows.findIndex((r) => r.year > event.year);
  const correctPosition = correctIndex === -1 ? timelineRows.length : correctIndex;
  const numPlayers = turnOrderRows.length;
  const nextTurnIndex = (room.turn_index + 1) % numPlayers;
  const nextTurnPlayerId = turnOrderRows[nextTurnIndex]?.player_id ?? null;

  db.transaction(() => {
    removeFromHandAndDraw(db, roomId, playerId, eventId);
    shiftTimelinePositions(db, roomId, correctPosition);
    db.prepare(
      `INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(roomId, eventId, correctPosition, playerId);
    db.prepare(
      `UPDATE rooms SET turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`,
    ).run(nextTurnIndex, roomId);
  })();

  let state = getRoomState(roomId)!;
  const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
  const gameEndsByTimeline = state.timeline.length >= maxTimelineSize;

  if (gameEndsByTimeline) {
    const winnerRows = db
      .prepare(
        "SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC",
      )
      .all(roomId) as { player_id: string; score: number }[];
    const maxScore = winnerRows[0]?.score ?? 0;
    const winnerPlayerId =
      winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
    db.prepare(
      `UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`,
    ).run(winnerPlayerId, roomId);
    state = getRoomState(roomId)!;
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
export function endGame(roomId: string, playerId: string): RoomState | { error: string } {
  const db = getDb();

  const room = db
    .prepare("SELECT id, status, host_player_id FROM rooms WHERE id = ?")
    .get(roomId) as { id: string; status: string; host_player_id: string | null } | undefined;

  if (!room) return { error: "Room not found" };
  if (room.status !== "playing") return { error: "Game is not in progress" };
  if (room.host_player_id !== playerId) return { error: "Only the host can end the game" };

  db.transaction(() => {
    db.prepare("DELETE FROM room_timeline WHERE room_id = ?").run(roomId);
    db.prepare("DELETE FROM room_deck WHERE room_id = ?").run(roomId);
    db.prepare("DELETE FROM room_hand WHERE room_id = ?").run(roomId);
    db.prepare(
      `UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
       WHERE id = ?`,
    ).run(roomId);
    db.prepare(
      "UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?",
    ).run(roomId);
  })();

  return getRoomState(roomId)!;
}

/** Rematch: reset room to lobby so the host can start a new game. Host only, room must be ended. */
export function rematchRoom(roomId: string, playerId: string): RoomState | { error: string } {
  const db = getDb();

  const room = db
    .prepare("SELECT id, status, host_player_id FROM rooms WHERE id = ?")
    .get(roomId) as { id: string; status: string; host_player_id: string | null } | undefined;

  if (!room) return { error: "Room not found" };
  if (room.status !== "ended") return { error: "Game is not finished" };
  if (room.host_player_id !== playerId) return { error: "Only the host can start a revanche" };

  const playerCount = db
    .prepare("SELECT COUNT(*) as c FROM room_players WHERE room_id = ?")
    .get(roomId) as { c: number };
  const connectedCount = db
    .prepare("SELECT COUNT(*) as c FROM room_players WHERE room_id = ? AND connected = 1")
    .get(roomId) as { c: number };
  if (playerCount.c < 2 || connectedCount.c < 2)
    return {
      error:
        "At least 2 players are required for a rematch. Wait for another player to join.",
    };

  db.transaction(() => {
    db.prepare("DELETE FROM room_timeline WHERE room_id = ?").run(roomId);
    db.prepare("DELETE FROM room_deck WHERE room_id = ?").run(roomId);
    db.prepare("DELETE FROM room_hand WHERE room_id = ?").run(roomId);
    db.prepare(
      `UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
       WHERE id = ?`,
    ).run(roomId);
    db.prepare(
      "UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?",
    ).run(roomId);
  })();

  return getRoomState(roomId)!;
}

/** Leave room (non-host only). In lobby: just remove player. In playing: remove player, keep timeline; if it was their turn, advance to next without placing a card. Returns new state and left player nickname for notification, or error. */
export function leaveRoom(
  roomId: string,
  playerId: string,
): { roomState: RoomState; leftPlayerNickname: string } | { error: string } {
  const db = getDb();

  const room = db
    .prepare(
      "SELECT id, status, host_player_id, turn_index FROM rooms WHERE id = ?",
    )
    .get(roomId) as {
      id: string;
      status: string;
      host_player_id: string | null;
      turn_index: number;
    } | undefined;

  if (!room) return { error: "Room not found" };
  if (room.host_player_id === playerId) {
    return { error: "Host cannot leave; use End game to return to lobby" };
  }

  const playerRow = db
    .prepare(
      "SELECT player_id, nickname FROM room_players WHERE room_id = ? AND player_id = ?",
    )
    .get(roomId, playerId) as { player_id: string; nickname: string } | undefined;
  if (!playerRow) return { error: "Player not in room" };
  const leftPlayerNickname = playerRow.nickname;

  if (room.status === "lobby") {
    db.prepare(
      "DELETE FROM room_players WHERE room_id = ? AND player_id = ?",
    ).run(roomId, playerId);
    const roomState = getRoomState(roomId);
    return {
      roomState: roomState!,
      leftPlayerNickname,
    };
  }

  if (room.status !== "playing") {
    return { error: "Room is not in lobby or playing" };
  }

  const turnOrderedRows = db
    .prepare(
      "SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order ASC",
    )
    .all(roomId) as { player_id: string }[];
  const orderedIds = turnOrderedRows.map((r) => r.player_id);
  const leavingIndex = orderedIds.indexOf(playerId);
  if (leavingIndex === -1) return { error: "Player not in room" };

  const currentTurnPlayerId = orderedIds[room.turn_index] ?? null;
  const wasCurrentTurn = currentTurnPlayerId === playerId;
  const newOrderedIds = orderedIds.filter((id) => id !== playerId);

  db.transaction(() => {
    db.prepare(
      "DELETE FROM room_hand WHERE room_id = ? AND player_id = ?",
    ).run(roomId, playerId);
    db.prepare(
      "DELETE FROM room_players WHERE room_id = ? AND player_id = ?",
    ).run(roomId, playerId);

    if (newOrderedIds.length < 2) {
      db.prepare("DELETE FROM room_timeline WHERE room_id = ?").run(roomId);
      db.prepare("DELETE FROM room_deck WHERE room_id = ?").run(roomId);
      db.prepare("DELETE FROM room_hand WHERE room_id = ?").run(roomId);
      db.prepare(
        `UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
         turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
         WHERE id = ?`,
      ).run(roomId);
      db.prepare(
        "UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?",
      ).run(roomId);
    } else {
      const nextPlayerId = wasCurrentTurn
        ? orderedIds[(room.turn_index + 1) % orderedIds.length]
        : currentTurnPlayerId;
      const newTurnIndex = newOrderedIds.indexOf(nextPlayerId!);
      if (newTurnIndex === -1) return;

      for (let i = 0; i < newOrderedIds.length; i++) {
        db.prepare(
          "UPDATE room_players SET turn_order = ? WHERE room_id = ? AND player_id = ?",
        ).run(i, roomId, newOrderedIds[i]);
      }
      db.prepare(
        `UPDATE rooms SET turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`,
      ).run(newTurnIndex, roomId);
    }
  })();

  const roomState = getRoomState(roomId, newOrderedIds[0]);
  return { roomState: roomState!, leftPlayerNickname };
}

/** Permanently close a room (host only). Deletes the room and all related data. Everyone must be redirected by the caller (broadcast room_closed). */
export function closeRoomPermanently(
  roomId: string,
  playerId: string,
): { ok: true } | { error: string } {
  const db = getDb();
  const room = db
    .prepare("SELECT id, host_player_id FROM rooms WHERE id = ?")
    .get(roomId) as { id: string; host_player_id: string | null } | undefined;
  if (!room) return { error: "Room not found" };
  if (room.host_player_id !== playerId) return { error: "Only the host can close the room" };
  db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
  return { ok: true };
}

/** Mark player as disconnected (for WebSocket close). */
export function setPlayerConnected(
  roomId: string,
  playerId: string,
  connected: boolean,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE room_players SET connected = ? WHERE room_id = ? AND player_id = ?",
  ).run(connected ? 1 : 0, roomId, playerId);
}
