/**
 * Integration tests for roomService with a real SQLite DB (test-data/integration.db).
 * Requires initDb() and seed data before tests; clears room tables between tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb, closeDb } from "../db/index.js";
import {
  createRoom,
  joinRoom,
  getRoomState,
  startGame,
  getNextEventForCurrentTurn,
  placeEvent,
  endGame,
  rematchRoom,
  setPlayerConnected,
} from "./roomService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_EVENTS = [
  { id: "e1", title: "Event 1900", type: "Film", display_title: "Event 1900 (Film)", year: 1900, image: "https://x/1.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e2", title: "Event 1950", type: "Film", display_title: "Event 1950 (Film)", year: 1950, image: "https://x/2.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e3", title: "Event 2000", type: "Film", display_title: "Event 2000 (Film)", year: 2000, image: "https://x/3.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e4", title: "Event 2005", type: "Film", display_title: "Event 2005 (Film)", year: 2005, image: "https://x/4.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e5", title: "Event 2010", type: "Film", display_title: "Event 2010 (Film)", year: 2010, image: "https://x/5.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
];

function ensureTestDataDir(): void {
  const dir = path.join(__dirname, "../../test-data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function seedTestEvents(): void {
  const db = getDb();
  for (const e of TEST_EVENTS) {
    db.prepare(`
      INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url, null);
  }
  const base = TEST_EVENTS.length;
  const needed = 160 - base;
  for (let i = 0; i < needed; i++) {
    const id = `e-extra-${i}`;
    const year = 1900 + (i % 120);
    db.prepare(`
      INSERT OR REPLACE INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score)
      VALUES (?, ?, 'Film', ?, ?, ?, ?, ?)
    `).run(id, `Event ${year}`, `Event ${year} (Film)`, year, null, null, null);
  }
}

function clearRoomTables(): void {
  const db = getDb();
  db.prepare("DELETE FROM room_hand").run();
  db.prepare("DELETE FROM room_deck").run();
  db.prepare("DELETE FROM room_timeline").run();
  db.prepare("DELETE FROM room_players").run();
  db.prepare("DELETE FROM rooms").run();
}

describe("roomService avatar (integration)", () => {
  beforeAll(async () => {
    ensureTestDataDir();
    await initDb();
    seedTestEvents();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    clearRoomTables();
  });

  it("getRoomState includes avatar for each player", () => {
    const created = createRoom("Host", "R", { avatar: "/avatars/character-1.png" });
    joinRoom(created.roomId, "P2", undefined, "/avatars/character-2.png");
    const state = getRoomState(created.roomId)!;
    expect(state.players).toHaveLength(2);
    expect(state.players.some((p) => p.avatar === "/avatars/character-1.png")).toBe(true);
    expect(state.players.some((p) => p.avatar === "/avatars/character-2.png")).toBe(true);
  });
});

describe("roomService (integration)", () => {
  beforeAll(async () => {
    ensureTestDataDir();
    await initDb();
    seedTestEvents();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    clearRoomTables();
  });

  it("createRoom returns roomId and playerId and room is in lobby", () => {
    const result = createRoom("Host", "Test Room");
    expect(result).toHaveProperty("roomId");
    expect(result).toHaveProperty("playerId");
    expect(result.roomState.status).toBe("lobby");
    expect(result.roomState.name).toBe("Test Room");
    expect(result.roomState.players).toHaveLength(1);
    expect(result.roomState.players[0]?.nickname).toBe("Host");
    expect(result.roomState.players[0]?.isHost).toBe(true);
  });

  it("createRoom and joinRoom store and return player avatar", () => {
    const avatarPath = "/avatars/character-5.png";
    const created = createRoom("Host", "Room", { avatar: avatarPath });
    expect(created.roomState.players[0]?.avatar).toBe(avatarPath);

    const join = joinRoom(created.roomId, "P2", undefined, "/avatars/character-3.png");
    expect("error" in join).toBe(false);
    const state = (join as { roomState: ReturnType<typeof getRoomState> }).roomState;
    const host = state.players.find((p) => p.playerId === created.playerId);
    const p2 = state.players.find((p) => p.nickname === "P2");
    expect(host?.avatar).toBe(avatarPath);
    expect(p2?.avatar).toBe("/avatars/character-3.png");
  });

  it("joinRoom adds second player and getRoomState reflects both", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const join = joinRoom(roomId, "Player2");
    expect("error" in join).toBe(false);
    const { playerId: p2Id, roomState } = join as { playerId: string; roomState: ReturnType<typeof getRoomState> };
    expect(roomState).not.toBeNull();
    expect(roomState!.players).toHaveLength(2);
    expect(roomState!.players.map((p) => p.nickname).sort()).toEqual(["Host", "Player2"]);

    const state = getRoomState(roomId);
    expect(state?.players).toHaveLength(2);
  });

  it("joinRoom returns error when room does not exist", () => {
    const result = joinRoom("non-existent-uuid", "P");
    expect(result).toEqual({ error: "Room not found" });
  });

  it("startGame fails with one player", () => {
    const { roomId, playerId } = createRoom("Host");
    const result = startGame(roomId, playerId);
    expect(result).toEqual({ error: "At least 2 players are required to start. Wait for another player to join." });
  });

  it("startGame succeeds with two players and sets status playing", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const join = joinRoom(roomId, "Player2") as { playerId: string; roomState: NonNullable<ReturnType<typeof getRoomState>> };
    const player2Id = join.playerId;

    const result = startGame(roomId, hostId);
    expect("error" in result).toBe(false);
    const state = result as NonNullable<ReturnType<typeof getRoomState>>;
    expect(state.status).toBe("playing");
    expect(state.timeline).toHaveLength(1);
    expect(state.currentTurnPlayerId).toBeDefined();
    expect(state.myHand).toBeDefined();
    expect(state.myHand).toHaveLength(3);
  });

  it("getRoomState returns myHand only for requested player", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const join = joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    startGame(roomId, hostId);

    const stateForHost = getRoomState(roomId, hostId)!;
    const stateForP2 = getRoomState(roomId, p2Id)!;

    expect(stateForHost.myHand).toHaveLength(3);
    expect(stateForP2.myHand).toHaveLength(3);
    const hostHandIds = new Set(stateForHost.myHand.map((e) => e.id));
    const p2HandIds = new Set(stateForP2.myHand.map((e) => e.id));
    hostHandIds.forEach((id) => expect(p2HandIds.has(id)).toBe(false));
  });

  it("placeEvent validates turn and returns correct/score when placement is correct", () => {
    const { roomId, playerId: hostId } = createRoom("Host", undefined, { pointsToWin: 2 });
    const join = joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    startGame(roomId, hostId);

    const roomState = getRoomState(roomId)!;
    const currentId = roomState.currentTurnPlayerId!;
    const state = getRoomState(roomId, currentId)!;
    const hand = state.myHand;
    expect(hand.length).toBeGreaterThanOrEqual(1);
    const eventId = hand[0]!.id;
    const eventYear = hand[0]!.year;
    const timelineYears = state.timeline.map((t) => t.event.year);
    const correctPos = timelineYears.findIndex((y) => y > eventYear) === -1 ? timelineYears.length : timelineYears.findIndex((y) => y > eventYear);

    const result = placeEvent(roomId, currentId, eventId, correctPos);
    expect("error" in result).toBe(false);
    const place = result as { correct: boolean; score: number; timeline: unknown[] };
    expect(place.correct).toBe(true);
    expect(place.score).toBe(1);
    expect(place.timeline).toHaveLength(2);

    const stateAfter = getRoomState(roomId, currentId)!;
    expect(stateAfter.myHand).toHaveLength(3);
  });

  it("placeEvent returns error when not player turn", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const join = joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    startGame(roomId, hostId);

    const roomState = getRoomState(roomId)!;
    const currentId = roomState.currentTurnPlayerId!;
    const otherId = currentId === hostId ? p2Id : hostId;
    const stateForCurrent = getRoomState(roomId, currentId)!;
    const eventId = stateForCurrent.myHand[0]!.id;

    const result = placeEvent(roomId, otherId, eventId, 1);
    expect(result).toEqual({ error: "Not your turn" });
  });

  it("endGame returns room to lobby with no winner", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    joinRoom(roomId, "P2");
    startGame(roomId, hostId);

    const result = endGame(roomId, hostId);
    expect("error" in result).toBe(false);
    const state = result as NonNullable<ReturnType<typeof getRoomState>>;
    expect(state.status).toBe("lobby");
    expect(state.winnerPlayerId).toBeNull();
    expect(state.timeline).toHaveLength(0);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
  });

  it("endGame returns error when not host", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const join = joinRoom(roomId, "P2") as { playerId: string };
    startGame(roomId, hostId);

    const result = endGame(roomId, join.playerId);
    expect(result).toEqual({ error: "Only the host can end the game" });
  });

  it("endGame returns error when room not found", () => {
    const result = endGame("non-existent-room-id", "some-player-id");
    expect(result).toEqual({ error: "Room not found" });
  });

  it("endGame returns error when game is not in progress", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const result = endGame(roomId, hostId);
    expect(result).toEqual({ error: "Game is not in progress" });
  });

  it("rematchRoom resets to lobby when host requests after game ended", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    joinRoom(roomId, "P2");
    startGame(roomId, hostId);
    getDb()
      .prepare(
        "UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?",
      )
      .run(hostId, roomId);

    const result = rematchRoom(roomId, hostId);
    expect("error" in result).toBe(false);
    const state = result as NonNullable<ReturnType<typeof getRoomState>>;
    expect(state.status).toBe("lobby");
    expect(state.timeline).toHaveLength(0);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
  });

  it("rematchRoom returns error when game not ended", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    joinRoom(roomId, "P2");
    startGame(roomId, hostId);

    const result = rematchRoom(roomId, hostId);
    expect(result).toEqual({ error: "Game is not finished" });
  });

  it("rematchRoom returns error when room not found", () => {
    const result = rematchRoom("non-existent-room-id", "some-host-id");
    expect(result).toEqual({ error: "Room not found" });
  });

  it("rematchRoom returns error when not enough players for revanche", () => {
    const { roomId, playerId: hostId } = createRoom("Host");
    const join = joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    startGame(roomId, hostId);
    getDb()
      .prepare(
        "UPDATE rooms SET status = 'ended', ended_at = datetime('now'), winner_player_id = ? WHERE id = ?",
      )
      .run(hostId, roomId);
    setPlayerConnected(roomId, p2Id, false);

    const result = rematchRoom(roomId, hostId);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("2 players");
  });
});
