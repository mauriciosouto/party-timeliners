import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
const INITIAL_DECK_SIZE = 200;
function eventToApi(e) {
    return {
        id: e.id,
        title: e.title,
        year: e.year,
        displayTitle: e.display_title,
        image: e.image ?? undefined,
        wikipediaUrl: e.wikipedia_url ?? undefined,
    };
}
function shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
const DEFAULT_MAX_TIMELINE_SIZE = 50;
const DEFAULT_POINTS_TO_WIN = 10;
/** Create a room and add the host as first player. Returns roomId and playerId. */
export function createRoom(hostNickname, roomName, options) {
    const db = getDb();
    const roomId = randomUUID();
    const playerId = randomUUID();
    const maxTimelineSize = options?.maxTimelineSize ?? DEFAULT_MAX_TIMELINE_SIZE;
    const pointsToWin = options?.pointsToWin ?? DEFAULT_POINTS_TO_WIN;
    const turnTimeLimitSeconds = options?.turnTimeLimitSeconds ?? null;
    db.transaction(() => {
        db.prepare(`INSERT INTO rooms (id, name, status, host_player_id, max_timeline_size, points_to_win, turn_time_limit_seconds)
       VALUES (?, ?, 'lobby', ?, ?, ?, ?)`).run(roomId, roomName ?? "Party Timeliners", playerId, maxTimelineSize, pointsToWin, turnTimeLimitSeconds);
        db.prepare(`INSERT INTO room_players (room_id, player_id, nickname, is_host, connected)
       VALUES (?, ?, ?, 1, 1)`).run(roomId, playerId, hostNickname);
    })();
    const roomState = getRoomState(roomId);
    return { roomId, playerId, roomState };
}
/** Add a player to a room (lobby only). Returns playerId and roomState. */
export function joinRoom(roomId, nickname, email) {
    const db = getDb();
    const room = db
        .prepare("SELECT id, status FROM rooms WHERE id = ?")
        .get(roomId);
    if (!room)
        return { error: "Room not found" };
    if (room.status !== "lobby")
        return { error: "Game already started" };
    const playerId = randomUUID();
    try {
        db.prepare(`INSERT INTO room_players (room_id, player_id, nickname, email, is_host, connected)
       VALUES (?, ?, ?, ?, 0, 1)`).run(roomId, playerId, nickname, email ?? null);
    }
    catch {
        return { error: "Failed to join room" };
    }
    const roomState = getRoomState(roomId);
    return { playerId, roomState };
}
/** Build full RoomState from DB. */
export function getRoomState(roomId) {
    const db = getDb();
    const room = db
        .prepare(`SELECT id, name, status, host_player_id, initial_event_id, next_deck_sequence,
              turn_index, turn_started_at, max_timeline_size, points_to_win, turn_time_limit_seconds,
              started_at, ended_at, winner_player_id
       FROM rooms WHERE id = ?`)
        .get(roomId);
    if (!room)
        return null;
    const playerRows = db
        .prepare(`SELECT player_id, nickname, is_host, turn_order, score, connected, joined_at
       FROM room_players WHERE room_id = ? ORDER BY joined_at`)
        .all(roomId);
    const players = playerRows.map((p) => ({
        playerId: p.player_id,
        nickname: p.nickname,
        isHost: p.is_host === 1,
        score: p.score,
        turnOrder: p.turn_order,
        connected: p.connected === 1,
        joinedAt: p.joined_at,
    }));
    const scores = {};
    playerRows.forEach((p) => (scores[p.player_id] = p.score));
    const timelineRows = db
        .prepare(`SELECT e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url,
              rt.position, rt.placed_by_player_id, rt.placed_at
       FROM room_timeline rt
       JOIN events e ON e.id = rt.event_id
       WHERE rt.room_id = ?
       ORDER BY rt.position`)
        .all(roomId);
    const timeline = timelineRows.map((r) => ({
        event: eventToApi(r),
        position: r.position,
        placedByPlayerId: r.placed_by_player_id,
        placedAt: r.placed_at,
    }));
    let turnOrder = [];
    let currentTurnPlayerId = null;
    let currentTurnStartedAt = null;
    if (room.status === "playing" && playerRows.length > 0) {
        const ordered = [...playerRows].sort((a, b) => (a.turn_order ?? 999) - (b.turn_order ?? 999));
        turnOrder = ordered.map((p) => p.player_id);
        currentTurnPlayerId = turnOrder[room.turn_index] ?? null;
        const raw = room.turn_started_at ?? room.started_at;
        currentTurnStartedAt =
            raw && typeof raw === "string" && raw.length === 19 && !raw.endsWith("Z")
                ? `${raw}Z`
                : raw;
    }
    return {
        roomId: room.id,
        name: room.name,
        status: room.status,
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
        nextDeckSequence: room.next_deck_sequence,
        initialEventId: room.initial_event_id,
        endedAt: room.ended_at,
        winnerPlayerId: room.winner_player_id,
    };
}
/** Start the game (host only, lobby only). Builds deck, assigns turn order, puts first event on timeline. */
export function startGame(roomId, playerId) {
    const db = getDb();
    const room = db
        .prepare("SELECT id, status, host_player_id FROM rooms WHERE id = ?")
        .get(roomId);
    if (!room)
        return { error: "Room not found" };
    if (room.status !== "lobby")
        return { error: "Game already started" };
    if (room.host_player_id !== playerId)
        return { error: "Only host can start" };
    const playerCount = db
        .prepare("SELECT COUNT(*) as c FROM room_players WHERE room_id = ?")
        .get(roomId);
    if (playerCount.c < 1)
        return { error: "Need at least one player" };
    const events = db.prepare("SELECT * FROM events").all();
    if (events.length < 2)
        return { error: "Not enough events in pool. Run seed first." };
    const shuffled = shuffle(events);
    const initialEvent = shuffled[0];
    const deckEvents = shuffled.slice(1, INITIAL_DECK_SIZE + 1);
    const playerIds = db
        .prepare("SELECT player_id FROM room_players WHERE room_id = ? ORDER BY joined_at")
        .all(roomId);
    const turnOrderShuffle = shuffle(playerIds.map((p) => p.player_id));
    db.transaction(() => {
        db.prepare(`UPDATE rooms SET status = 'playing', initial_event_id = ?, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = datetime('now'), started_at = datetime('now') WHERE id = ?`).run(initialEvent.id, roomId);
        db.prepare(`INSERT INTO room_timeline (room_id, event_id, position, placed_at) VALUES (?, ?, 0, datetime('now'))`).run(roomId, initialEvent.id);
        turnOrderShuffle.forEach((pid, i) => {
            db.prepare("UPDATE room_players SET turn_order = ?, score = 0 WHERE room_id = ? AND player_id = ?").run(i, roomId, pid);
        });
        const insertDeck = db.prepare("INSERT INTO room_deck (room_id, event_id, sequence) VALUES (?, ?, ?)");
        deckEvents.forEach((e, i) => insertDeck.run(roomId, e.id, i));
    })();
    return getRoomState(roomId);
}
/** Get the next event to place (only for the current turn player). */
export function getNextEventForCurrentTurn(roomId, playerId) {
    const state = getRoomState(roomId);
    if (!state || state.status !== "playing")
        return null;
    if (state.currentTurnPlayerId !== playerId)
        return null;
    const db = getDb();
    const row = db
        .prepare(`SELECT e.* FROM room_deck rd
       JOIN events e ON e.id = rd.event_id
       WHERE rd.room_id = ? AND rd.sequence = ?`)
        .get(roomId, state.nextDeckSequence);
    return row ? eventToApi(row) : null;
}
/** Place event (current turn player only). Same validation as before; score is per-player. */
export function placeEvent(roomId, playerId, eventId, position) {
    const db = getDb();
    const room = db
        .prepare("SELECT id, status, next_deck_sequence, turn_index, max_timeline_size, points_to_win FROM rooms WHERE id = ?")
        .get(roomId);
    if (!room || room.status !== "playing")
        return { error: "Room not found or not playing" };
    const turnOrderRows = db
        .prepare("SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order")
        .all(roomId);
    const currentPlayerId = turnOrderRows[room.turn_index]?.player_id;
    if (currentPlayerId !== playerId)
        return { error: "Not your turn" };
    const event = db
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(eventId);
    if (!event)
        return { error: "Event not found" };
    const deckRow = db
        .prepare("SELECT event_id FROM room_deck WHERE room_id = ? AND sequence = ?")
        .get(roomId, room.next_deck_sequence);
    if (!deckRow || deckRow.event_id !== eventId)
        return { error: "Wrong event for this turn" };
    const timelineRows = db
        .prepare(`SELECT e.year, rt.position FROM room_timeline rt
       JOIN events e ON e.id = rt.event_id WHERE rt.room_id = ? ORDER BY rt.position`)
        .all(roomId);
    const prevYear = position > 0 ? timelineRows[position - 1]?.year : -Infinity;
    const nextYear = position < timelineRows.length ? timelineRows[position]?.year : Infinity;
    const correct = event.year >= prevYear && event.year <= nextYear;
    const playerScore = db
        .prepare("SELECT score FROM room_players WHERE room_id = ? AND player_id = ?")
        .get(roomId, playerId);
    if (!correct) {
        const correctIndex = timelineRows.findIndex((r) => r.year > event.year);
        const correctPosition = correctIndex === -1 ? timelineRows.length : correctIndex;
        const numPlayers = turnOrderRows.length;
        const nextTurnIndex = (room.turn_index + 1) % numPlayers;
        const nextTurnPlayerId = turnOrderRows[nextTurnIndex]?.player_id ?? null;
        db.transaction(() => {
            db.prepare(`UPDATE room_timeline SET position = position + 1 WHERE room_id = ? AND position >= ?`).run(roomId, correctPosition);
            db.prepare(`INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`).run(roomId, eventId, correctPosition, playerId);
            db.prepare(`UPDATE rooms SET next_deck_sequence = next_deck_sequence + 1, turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`).run(nextTurnIndex, roomId);
        })();
        const state = getRoomState(roomId);
        const newTimelineLength = state.timeline.length;
        const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
        const gameEndsByTimeline = newTimelineLength >= maxTimelineSize;
        if (gameEndsByTimeline) {
            const winnerRows = db
                .prepare("SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC")
                .all(roomId);
            const maxScore = winnerRows[0]?.score ?? 0;
            const winnerPlayerId = winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
            db.prepare(`UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`).run(winnerPlayerId, roomId);
            const finalState = getRoomState(roomId);
            return {
                correct: false,
                gameEnded: true,
                correctPosition,
                score: playerScore.score,
                timeline: finalState.timeline,
                nextTurnPlayerId: null,
            };
        }
        const nextEvent = getNextEventForCurrentTurn(roomId, nextTurnPlayerId ?? "");
        return {
            correct: false,
            gameEnded: false,
            correctPosition,
            score: playerScore.score,
            timeline: state.timeline,
            nextEvent: nextEvent ?? null,
            nextTurnPlayerId,
        };
    }
    const numPlayers = turnOrderRows.length;
    const nextTurnIndex = (room.turn_index + 1) % numPlayers;
    const nextTurnPlayerId = turnOrderRows[nextTurnIndex]?.player_id ?? null;
    const newTimelineLength = timelineRows.length + 1;
    const newScore = (playerScore?.score ?? 0) + 1;
    const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
    const pointsToWin = room.points_to_win ?? DEFAULT_POINTS_TO_WIN;
    const gameEndsByTimeline = newTimelineLength >= maxTimelineSize;
    const gameEndsByScore = newScore >= pointsToWin;
    db.transaction(() => {
        db.prepare(`UPDATE room_timeline SET position = position + 1 WHERE room_id = ? AND position >= ?`).run(roomId, position);
        db.prepare(`INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
       VALUES (?, ?, ?, ?, datetime('now'))`).run(roomId, eventId, position, playerId);
        db.prepare("UPDATE room_players SET score = score + 1 WHERE room_id = ? AND player_id = ?").run(roomId, playerId);
        db.prepare(`UPDATE rooms SET next_deck_sequence = next_deck_sequence + 1, turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`).run(nextTurnIndex, roomId);
    })();
    let state = getRoomState(roomId);
    if (gameEndsByTimeline || gameEndsByScore) {
        const winnerRows = db
            .prepare("SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC")
            .all(roomId);
        const maxScore = winnerRows[0]?.score ?? 0;
        const winnerPlayerId = winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
        db.prepare(`UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`).run(winnerPlayerId, roomId);
        state = getRoomState(roomId);
        return {
            correct: true,
            gameEnded: true,
            score: state.scores[playerId] ?? 0,
            timeline: state.timeline,
            nextEvent: null,
            nextTurnPlayerId: null,
        };
    }
    const nextEvent = getNextEventForCurrentTurn(roomId, nextTurnPlayerId ?? "");
    return {
        correct: true,
        score: state.scores[playerId] ?? 0,
        timeline: state.timeline,
        nextEvent: nextEvent ?? null,
        nextTurnPlayerId,
    };
}
/** Turn timeout: current player didn't place in time. Event is placed at correct position on timeline (no point). */
export function timeoutTurn(roomId, playerId) {
    const db = getDb();
    const room = db
        .prepare("SELECT id, status, turn_index, next_deck_sequence, turn_time_limit_seconds, max_timeline_size FROM rooms WHERE id = ?")
        .get(roomId);
    if (!room || room.status !== "playing")
        return { error: "Room not found or not playing" };
    if (room.turn_time_limit_seconds == null)
        return { error: "No turn time limit set" };
    const turnOrderRows = db
        .prepare("SELECT player_id FROM room_players WHERE room_id = ? ORDER BY turn_order")
        .all(roomId);
    const currentPlayerId = turnOrderRows[room.turn_index]?.player_id;
    if (currentPlayerId !== playerId)
        return { error: "Not your turn" };
    const deckRow = db
        .prepare("SELECT event_id FROM room_deck WHERE room_id = ? AND sequence = ?")
        .get(roomId, room.next_deck_sequence);
    if (!deckRow)
        return { error: "No event in deck for this turn" };
    const event = db
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(deckRow.event_id);
    if (!event)
        return { error: "Event not found" };
    const timelineRows = db
        .prepare(`SELECT e.year, rt.position FROM room_timeline rt
       JOIN events e ON e.id = rt.event_id WHERE rt.room_id = ? ORDER BY rt.position`)
        .all(roomId);
    const correctIndex = timelineRows.findIndex((r) => r.year > event.year);
    const correctPosition = correctIndex === -1 ? timelineRows.length : correctIndex;
    const numPlayers = turnOrderRows.length;
    const nextTurnIndex = (room.turn_index + 1) % numPlayers;
    const nextTurnPlayerId = turnOrderRows[nextTurnIndex]?.player_id ?? null;
    db.transaction(() => {
        db.prepare(`UPDATE room_timeline SET position = position + 1 WHERE room_id = ? AND position >= ?`).run(roomId, correctPosition);
        db.prepare(`INSERT INTO room_timeline (room_id, event_id, position, placed_by_player_id, placed_at)
       VALUES (?, ?, ?, ?, datetime('now'))`).run(roomId, deckRow.event_id, correctPosition, playerId);
        db.prepare(`UPDATE rooms SET next_deck_sequence = next_deck_sequence + 1, turn_index = ?, turn_started_at = datetime('now') WHERE id = ?`).run(nextTurnIndex, roomId);
    })();
    let state = getRoomState(roomId);
    const maxTimelineSize = room.max_timeline_size ?? DEFAULT_MAX_TIMELINE_SIZE;
    const gameEndsByTimeline = state.timeline.length >= maxTimelineSize;
    if (gameEndsByTimeline) {
        const winnerRows = db
            .prepare("SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC")
            .all(roomId);
        const maxScore = winnerRows[0]?.score ?? 0;
        const winnerPlayerId = winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
        db.prepare(`UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`).run(winnerPlayerId, roomId);
        state = getRoomState(roomId);
        return {
            nextTurnPlayerId: null,
            nextEvent: null,
            gameEnded: true,
            timeline: state.timeline,
        };
    }
    const nextEvent = nextTurnPlayerId
        ? getNextEventForCurrentTurn(roomId, nextTurnPlayerId)
        : null;
    return {
        nextTurnPlayerId,
        nextEvent: nextEvent ?? null,
        gameEnded: false,
        timeline: state.timeline,
    };
}
/** End the game now. Host only, room must be playing. Winner is the player with highest score. */
export function endGame(roomId, playerId) {
    const db = getDb();
    const room = db
        .prepare("SELECT id, status, host_player_id FROM rooms WHERE id = ?")
        .get(roomId);
    if (!room)
        return { error: "Room not found" };
    if (room.status !== "playing")
        return { error: "Game is not in progress" };
    if (room.host_player_id !== playerId)
        return { error: "Only the host can end the game" };
    const winnerRows = db
        .prepare("SELECT player_id, score FROM room_players WHERE room_id = ? ORDER BY score DESC")
        .all(roomId);
    const maxScore = winnerRows[0]?.score ?? 0;
    const winnerPlayerId = winnerRows.find((r) => r.score === maxScore)?.player_id ?? null;
    db.prepare(`UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?`).run(winnerPlayerId, roomId);
    return getRoomState(roomId);
}
/** Rematch: reset room to lobby so the host can start a new game. Host only, room must be ended. */
export function rematchRoom(roomId, playerId) {
    const db = getDb();
    const room = db
        .prepare("SELECT id, status, host_player_id FROM rooms WHERE id = ?")
        .get(roomId);
    if (!room)
        return { error: "Room not found" };
    if (room.status !== "ended")
        return { error: "Game is not finished" };
    if (room.host_player_id !== playerId)
        return { error: "Only the host can start a revanche" };
    db.transaction(() => {
        db.prepare("DELETE FROM room_timeline WHERE room_id = ?").run(roomId);
        db.prepare("DELETE FROM room_deck WHERE room_id = ?").run(roomId);
        db.prepare(`UPDATE rooms SET status = 'lobby', initial_event_id = NULL, next_deck_sequence = 0,
       turn_index = 0, turn_started_at = NULL, started_at = NULL, ended_at = NULL, winner_player_id = NULL
       WHERE id = ?`).run(roomId);
        db.prepare("UPDATE room_players SET score = 0, turn_order = NULL WHERE room_id = ?").run(roomId);
    })();
    return getRoomState(roomId);
}
/** Mark player as disconnected (for WebSocket close). */
export function setPlayerConnected(roomId, playerId, connected) {
    const db = getDb();
    db.prepare("UPDATE room_players SET connected = ? WHERE room_id = ? AND player_id = ?").run(connected ? 1 : 0, roomId, playerId);
}
