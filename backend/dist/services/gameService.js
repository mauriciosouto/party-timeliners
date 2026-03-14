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
export function createGame() {
    const db = getDb();
    const events = db.prepare("SELECT * FROM events").all();
    if (events.length < 2) {
        throw new Error("Not enough events in pool. Run seed first.");
    }
    const gameId = randomUUID();
    const shuffled = shuffle(events);
    const initialEvent = shuffled[0];
    const deckEvents = shuffled.slice(1, INITIAL_DECK_SIZE + 1);
    db.transaction(() => {
        db.prepare("INSERT INTO games (id, status, score, initial_event_id, next_deck_sequence) VALUES (?, 'active', 0, ?, 0)").run(gameId, initialEvent.id);
        db.prepare("INSERT INTO game_timeline (game_id, event_id, position, placed_at) VALUES (?, ?, 0, datetime('now'))").run(gameId, initialEvent.id);
        const insertDeck = db.prepare("INSERT INTO game_deck (game_id, event_id, sequence) VALUES (?, ?, ?)");
        deckEvents.forEach((e, i) => insertDeck.run(gameId, e.id, i));
    })();
    const nextRow = db
        .prepare("SELECT e.* FROM game_deck gd JOIN events e ON e.id = gd.event_id WHERE gd.game_id = ? AND gd.sequence = 0")
        .get(gameId);
    if (!nextRow) {
        throw new Error("Deck empty after create.");
    }
    return {
        gameId,
        status: "active",
        score: 0,
        timeline: [{ event: eventToApi(initialEvent), position: 0 }],
        nextEvent: eventToApi(nextRow),
    };
}
export function getGameState(gameId) {
    const db = getDb();
    const game = db
        .prepare("SELECT id, status, score FROM games WHERE id = ?")
        .get(gameId);
    if (!game)
        return null;
    const rows = db
        .prepare(`SELECT e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url, gt.position
       FROM game_timeline gt
       JOIN events e ON e.id = gt.event_id
       WHERE gt.game_id = ?
       ORDER BY gt.position`)
        .all(gameId);
    const timeline = rows.map((r) => ({
        event: eventToApi(r),
        position: r.position,
    }));
    return {
        gameId: game.id,
        status: game.status,
        score: game.score,
        timeline,
    };
}
export function getNextEvent(gameId) {
    const db = getDb();
    const game = db
        .prepare("SELECT status, next_deck_sequence FROM games WHERE id = ?")
        .get(gameId);
    if (!game || game.status !== "active")
        return null;
    const row = db
        .prepare(`SELECT e.* FROM game_deck gd
       JOIN events e ON e.id = gd.event_id
       WHERE gd.game_id = ? AND gd.sequence = ?`)
        .get(gameId, game.next_deck_sequence);
    return row ? eventToApi(row) : null;
}
export function placeEvent(gameId, eventId, position) {
    const db = getDb();
    const game = db
        .prepare("SELECT id, status, score, next_deck_sequence FROM games WHERE id = ?")
        .get(gameId);
    if (!game || game.status !== "active")
        return null;
    const event = db
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(eventId);
    if (!event)
        return null;
    const timelineRows = db
        .prepare(`SELECT e.id, e.year, gt.position
       FROM game_timeline gt
       JOIN events e ON e.id = gt.event_id
       WHERE gt.game_id = ?
       ORDER BY gt.position`)
        .all(gameId);
    const prevYear = position > 0 ? timelineRows[position - 1]?.year : -Infinity;
    const nextYear = position < timelineRows.length
        ? timelineRows[position]?.year
        : Infinity;
    const correct = event.year >= prevYear && event.year <= nextYear;
    if (!correct) {
        db.prepare("UPDATE games SET status = 'ended' WHERE id = ?").run(gameId);
        const correctIndex = timelineRows.findIndex((r) => r.year > event.year);
        const correctPosition = correctIndex === -1 ? timelineRows.length : correctIndex;
        const updatedTimeline = getGameState(gameId).timeline;
        return {
            correct: false,
            gameEnded: true,
            correctPosition,
            score: game.score,
            timeline: updatedTimeline,
        };
    }
    db.transaction(() => {
        db.prepare("UPDATE game_timeline SET position = position + 1 WHERE game_id = ? AND position >= ?").run(gameId, position);
        db.prepare("INSERT INTO game_timeline (game_id, event_id, position, placed_at) VALUES (?, ?, ?, datetime('now'))").run(gameId, eventId, position);
        db.prepare("UPDATE games SET score = score + 1, next_deck_sequence = next_deck_sequence + 1 WHERE id = ?").run(gameId);
    })();
    const updated = getGameState(gameId);
    const nextEvent = getNextEvent(gameId);
    return {
        correct: true,
        score: updated.score,
        timeline: updated.timeline,
        nextEvent: nextEvent ?? null,
    };
}
