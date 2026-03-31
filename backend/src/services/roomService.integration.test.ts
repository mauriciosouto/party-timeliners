/**
 * Integration tests for roomService against PostgreSQL.
 * Set TEST_DATABASE_URL to run them (local docker Postgres or CI — see workflow).
 * DATABASE_URL alone is not used here so app `.env` does not flip these tests on accidentally.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, closeDb, exec } from "../db/index.js";
import {
  createRoom,
  joinRoom,
  getRoomState,
  startGame,
  getNextEventForCurrentTurn,
  placeEvent,
  endGame,
  rematchRoom,
  leaveRoom,
  closeRoomPermanently,
  setPlayerConnected,
} from "./roomService.js";
import { __testClearAllLiveRooms, liveRoomTestHelpers } from "./liveRoomStore.js";
import { findCorrectPosition } from "../game/timeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hasIntegrationDb = Boolean(process.env.TEST_DATABASE_URL);
const idesc = hasIntegrationDb ? describe : describe.skip;

type RoomStateResolved = NonNullable<Awaited<ReturnType<typeof getRoomState>>>;

const TEST_EVENTS = [
  { id: "e1", title: "Event 1900", type: "Film", display_title: "Event 1900 (Film)", year: 1900, image: "https://x/1.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e2", title: "Event 1920", type: "Film", display_title: "Event 1920 (Film)", year: 1920, image: "https://x/2.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e3", title: "Event 1950", type: "Film", display_title: "Event 1950 (Film)", year: 1950, image: "https://x/3.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e4", title: "Event 1975", type: "Film", display_title: "Event 1975 (Film)", year: 1975, image: "https://x/4.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e5", title: "Event 1985", type: "Film", display_title: "Event 1985 (Film)", year: 1985, image: "https://x/5.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e6", title: "Event 2000", type: "Film", display_title: "Event 2000 (Film)", year: 2000, image: "https://x/6.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e7", title: "Event 2005", type: "Film", display_title: "Event 2005 (Film)", year: 2005, image: "https://x/7.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
  { id: "e8", title: "Event 2010", type: "Film", display_title: "Event 2010 (Film)", year: 2010, image: "https://x/8.jpg", wikipedia_url: "https://en.wikipedia.org/wiki/X" },
];

async function seedTestEvents(): Promise<void> {
  const now = new Date().toISOString();
  const upsert = `INSERT INTO events (id, title, type, display_title, year, image, wikipedia_url, popularity_score, refreshed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, type = EXCLUDED.type, display_title = EXCLUDED.display_title,
      year = EXCLUDED.year, image = EXCLUDED.image, wikipedia_url = EXCLUDED.wikipedia_url,
      popularity_score = EXCLUDED.popularity_score, refreshed_at = EXCLUDED.refreshed_at`;
  for (const e of TEST_EVENTS) {
    await exec(upsert, [e.id, e.title, e.type, e.display_title, e.year, e.image, e.wikipedia_url, null, now, now]);
  }
  const base = TEST_EVENTS.length;
  const needed = 160 - base;
  for (let i = 0; i < needed; i++) {
    const id = `e-extra-${i}`;
    const year = 1900 + (i % 120);
    const title = `Event ${year}`;
    await exec(upsert, [id, title, "Film", `${title} (Film)`, year, null, null, null, now, now]);
  }
}

async function clearRoomTables(): Promise<void> {
  __testClearAllLiveRooms();
  await exec("DELETE FROM room_match_metrics", []);
  await exec("DELETE FROM room_hand", []);
  await exec("DELETE FROM room_deck", []);
  await exec("DELETE FROM room_timeline", []);
  await exec("DELETE FROM room_players", []);
  await exec("DELETE FROM rooms", []);
}

/** Override current turn player's hand with given event IDs (for deterministic timeline tests). */
async function setCurrentPlayerHand(roomId: string, eventIds: string[]): Promise<void> {
  const state = (await getRoomState(roomId))!;
  const currentId = state.currentTurnPlayerId!;
  liveRoomTestHelpers.setPlayerHand(roomId, currentId, eventIds.slice(0, 3));
}

/** Replace timeline with exactly these event IDs in order (position 0, 1, ...). Use after startGame for deterministic setups. */
async function setTimelineToEventIds(roomId: string, eventIds: string[]): Promise<void> {
  liveRoomTestHelpers.setTimelineEventIds(roomId, eventIds);
}

idesc("roomService avatar (integration)", () => {
  beforeAll(async () => {
    await initDb();
    await seedTestEvents();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearRoomTables();
  });

  it("getRoomState includes avatar for each player", async () => {
    const created = await createRoom("Host", "R", { avatar: "/avatars/character-1.png" });
    await joinRoom(created.roomId, "P2", undefined, "/avatars/character-2.png");
    const state = (await getRoomState(created.roomId))!;
    expect(state.players).toHaveLength(2);
    expect(state.players.some((p) => p.avatar === "/avatars/character-1.png")).toBe(true);
    expect(state.players.some((p) => p.avatar === "/avatars/character-2.png")).toBe(true);
  });
});

idesc("roomService (integration)", () => {
  beforeAll(async () => {
    await initDb();
    await seedTestEvents();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearRoomTables();
  });

  it("createRoom returns roomId and playerId and room is in lobby", async () => {
    const result = await createRoom("Host", "Test Room");
    expect(result).toHaveProperty("roomId");
    expect(result).toHaveProperty("playerId");
    expect(result.roomState.status).toBe("lobby");
    expect(result.roomState.name).toBe("Test Room");
    expect(result.roomState.players).toHaveLength(1);
    expect(result.roomState.players[0]?.nickname).toBe("Host");
    expect(result.roomState.players[0]?.isHost).toBe(true);
  });

  it("createRoom and joinRoom store and return player avatar", async () => {
    const avatarPath = "/avatars/character-5.png";
    const created = await createRoom("Host", "Room", { avatar: avatarPath });
    expect(created.roomState.players[0]?.avatar).toBe(avatarPath);

    const join = await joinRoom(created.roomId, "P2", undefined, "/avatars/character-3.png");
    expect("error" in join).toBe(false);
    const state = (join as { roomState: ReturnType<typeof getRoomState> }).roomState;
    const host = state.players.find((p) => p.playerId === created.playerId);
    const p2 = state.players.find((p) => p.nickname === "P2");
    expect(host?.avatar).toBe(avatarPath);
    expect(p2?.avatar).toBe("/avatars/character-3.png");
  });

  it("joinRoom adds second player and getRoomState reflects both", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const join = await joinRoom(roomId, "Player2");
    expect("error" in join).toBe(false);
    const { playerId: p2Id, roomState } = join as { playerId: string; roomState: ReturnType<typeof getRoomState> };
    expect(roomState).not.toBeNull();
    expect(roomState!.players).toHaveLength(2);
    expect(roomState!.players.map((p) => p.nickname).sort()).toEqual(["Host", "Player2"]);

    const state = await getRoomState(roomId);
    expect(state?.players).toHaveLength(2);
  });

  it("joinRoom returns error when room does not exist", async () => {
    const result = await joinRoom("non-existent-uuid", "P");
    expect(result).toEqual({ error: "Room not found" });
  });

  it("startGame fails with one player", async () => {
    const { roomId, playerId } = await createRoom("Host");
    const result = await startGame(roomId, playerId);
    expect(result).toEqual({ error: "At least 2 players are required to start. Wait for another player to join." });
  });

  it("startGame succeeds with two players and sets status playing", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const join = await joinRoom(roomId, "Player2") as { playerId: string; roomState: RoomStateResolved };
    const player2Id = join.playerId;

    const result = await startGame(roomId, hostId);
    expect("error" in result).toBe(false);
    const state = result as RoomStateResolved;
    expect(state.status).toBe("playing");
    expect(state.timeline).toHaveLength(1);
    expect(state.currentTurnPlayerId).toBeDefined();
    expect(state.myHand).toBeDefined();
    expect(state.myHand).toHaveLength(3);
  });

  it("getRoomState returns myHand only for requested player", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const join = await joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    await startGame(roomId, hostId);

    const stateForHost = (await getRoomState(roomId, hostId))!;
    const stateForP2 = (await getRoomState(roomId, p2Id))!;

    expect(stateForHost.myHand).toHaveLength(3);
    expect(stateForP2.myHand).toHaveLength(3);
    const hostHandIds = new Set(stateForHost.myHand.map((e) => e.id));
    const p2HandIds = new Set(stateForP2.myHand.map((e) => e.id));
    hostHandIds.forEach((id) => expect(p2HandIds.has(id)).toBe(false));
  });

  it("placeEvent validates turn and returns correct/score when placement is correct", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host", undefined, { pointsToWin: 2 });
    const join = await joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    await startGame(roomId, hostId);

    const roomState = (await getRoomState(roomId))!;
    const currentId = roomState.currentTurnPlayerId!;
    const state = (await getRoomState(roomId, currentId))!;
    const hand = state.myHand;
    expect(hand.length).toBeGreaterThanOrEqual(1);
    const eventId = hand[0]!.id;
    const eventYear = hand[0]!.year;
    const timelineYears = state.timeline.map((t) => t.event.year);
    const correctPos = timelineYears.findIndex((y) => y > eventYear) === -1 ? timelineYears.length : timelineYears.findIndex((y) => y > eventYear);

    const result = await placeEvent(roomId, currentId, eventId, correctPos);
    expect("error" in result).toBe(false);
    const place = result as { correct: boolean; score: number; timeline: unknown[] };
    expect(place.correct).toBe(true);
    expect(place.score).toBe(1);
    expect(place.timeline).toHaveLength(2);

    const stateAfter = (await getRoomState(roomId, currentId))!;
    expect(stateAfter.myHand).toHaveLength(3);
  });

  it("placeEvent returns error when not player turn", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const join = await joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    await startGame(roomId, hostId);

    const roomState = (await getRoomState(roomId))!;
    const currentId = roomState.currentTurnPlayerId!;
    const otherId = currentId === hostId ? p2Id : hostId;
    const stateForCurrent = (await getRoomState(roomId, currentId))!;
    const eventId = stateForCurrent.myHand[0]!.id;

    const result = await placeEvent(roomId, otherId, eventId, 1);
    expect(result).toEqual({ error: "Not your turn" });
  });

  describe("timeline order after placement", () => {
    type TimelineEntry = { event: { year: number }; position: number };

    function getTimelineYears(timeline: TimelineEntry[]): number[] {
      return [...timeline].sort((a, b) => a.position - b.position).map((t) => t.event.year);
    }

    function expectTimelineChronological(timeline: TimelineEntry[]): void {
      const years = getTimelineYears(timeline);
      for (let i = 1; i < years.length; i++) {
        expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]!);
      }
    }

    it("timeline stays chronological after correct placement at beginning", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);

      let state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const hand = state.myHand;
      const timelineYears = state.timeline.map((t) => t.event.year);
      const eventYear = hand[0]!.year;
      const correctPos = findCorrectPosition(timelineYears, eventYear);
      const placeAtBeginning = 0;
      const position = correctPos === 0 ? placeAtBeginning : correctPos;

      const result = await placeEvent(roomId, state.currentTurnPlayerId!, hand[0]!.id, position);
      expect("error" in result).toBe(false);
      const place = result as { timeline: TimelineEntry[] };
      expectTimelineChronological(place.timeline);

      const stateAfter = (await getRoomState(roomId))!;
      expectTimelineChronological(stateAfter.timeline);
    });

    it("timeline stays chronological after correct placement in middle", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const timelineYears = state.timeline.map((t) => t.event.year);
      const eventYear = state.myHand[0]!.year;
      const correctPos = findCorrectPosition(timelineYears, eventYear);
      const mid = Math.floor((state.timeline.length + 1) / 2);
      const position = correctPos >= 0 && correctPos <= state.timeline.length ? correctPos : mid;

      const result = await placeEvent(roomId, state.currentTurnPlayerId!, state.myHand[0]!.id, position);
      expect("error" in result).toBe(false);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);
      expectTimelineChronological((await getRoomState(roomId))!.timeline);
    });

    it("timeline stays chronological after correct placement at end", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const timelineYears = state.timeline.map((t) => t.event.year);
      const eventYear = state.myHand[0]!.year;
      const correctPos = findCorrectPosition(timelineYears, eventYear);
      const position = correctPos === state.timeline.length ? state.timeline.length : correctPos;

      const result = await placeEvent(roomId, state.currentTurnPlayerId!, state.myHand[0]!.id, position);
      expect("error" in result).toBe(false);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);
      expectTimelineChronological((await getRoomState(roomId))!.timeline);
    });

    it("timeline stays chronological after incorrect placement (player drops at wrong slot)", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const eventId = state.myHand[0]!.id;
      const eventYear = state.myHand[0]!.year;
      const timelineYears = state.timeline.map((t) => t.event.year);
      const correctPosition = findCorrectPosition(timelineYears, eventYear);
      const wrongPosition =
        correctPosition === 0
          ? state.timeline.length
          : correctPosition === state.timeline.length
            ? 0
            : (correctPosition + 1) % (state.timeline.length + 1);

      const result = await placeEvent(roomId, state.currentTurnPlayerId!, eventId, wrongPosition);
      expect("error" in result).toBe(false);
      const place = result as { correct: boolean; timeline: TimelineEntry[]; correctPosition?: number };
      expect(place.correct).toBe(false);
      expectTimelineChronological(place.timeline);
      expect((await getRoomState(roomId))!.timeline.map((t) => t.event.year)).toEqual(
        getTimelineYears(place.timeline),
      );
    });

    it("multiple correct and incorrect placements keep timeline chronological", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host", undefined, { maxTimelineSize: 8 });
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e6"]);

      await setCurrentPlayerHand(roomId, ["e1", "e2", "e3"]);
      let state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      let result = await placeEvent(roomId, state.currentTurnPlayerId!, "e1", 1);
      expect("error" in result).toBe(false);
      expect((result as { correct: boolean }).correct).toBe(false);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);

      await setCurrentPlayerHand(roomId, ["e8", "e7", "e5"]);
      state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      result = await placeEvent(roomId, state.currentTurnPlayerId!, "e8", state.timeline.length);
      expect("error" in result).toBe(false);
      expect((result as { correct: boolean }).correct).toBe(true);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);

      await setCurrentPlayerHand(roomId, ["e2", "e4", "e5"]);
      state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      result = await placeEvent(roomId, state.currentTurnPlayerId!, state.myHand[0]!.id, 0);
      expect("error" in result).toBe(false);
      expect((result as { correct: boolean }).correct).toBe(false);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);

      expectTimelineChronological((await getRoomState(roomId))!.timeline);
    });

    it("correct placement at beginning (deterministic setup): event before all", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e6"]);
      await setCurrentPlayerHand(roomId, ["e1", "e2", "e4"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e1", 0);
      expect("error" in result).toBe(false);
      expect((result as { correct: boolean }).correct).toBe(true);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);
      expect(getTimelineYears((result as { timeline: TimelineEntry[] }).timeline)).toEqual([1900, 2000]);
    });

    it("correct placement at end (deterministic setup): event after all", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e1"]);
      await setCurrentPlayerHand(roomId, ["e8", "e7", "e6"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const position = state.timeline.length;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e8", position);
      expect("error" in result).toBe(false);
      expect((result as { correct: boolean }).correct).toBe(true);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);
      expect(getTimelineYears((result as { timeline: TimelineEntry[] }).timeline)).toEqual([1900, 2010]);
    });

    it("correct placement in middle (deterministic setup)", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e1", "e6"]);
      await setCurrentPlayerHand(roomId, ["e3", "e4", "e5"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e3", 1);
      expect("error" in result).toBe(false);
      expect((result as { correct: boolean }).correct).toBe(true);
      expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);
      expect(getTimelineYears((result as { timeline: TimelineEntry[] }).timeline)).toEqual([1900, 1950, 2000]);
    });

    it("incorrect placement: should be at beginning but player places at end → event moved to correct position", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e6"]);
      await setCurrentPlayerHand(roomId, ["e1", "e2", "e4"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e1", 1);
      expect("error" in result).toBe(false);
      const place = result as { correct: boolean; timeline: TimelineEntry[]; correctPosition: number };
      expect(place.correct).toBe(false);
      expect(place.correctPosition).toBe(0);
      expectTimelineChronological(place.timeline);
      expect(getTimelineYears(place.timeline)).toEqual([1900, 2000]);
    });

    it("incorrect placement: should be at end but player places at beginning → event moved to correct position", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e1"]);
      await setCurrentPlayerHand(roomId, ["e8", "e7", "e6"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e8", 0);
      expect("error" in result).toBe(false);
      const place = result as { correct: boolean; timeline: TimelineEntry[]; correctPosition: number };
      expect(place.correct).toBe(false);
      expect(place.correctPosition).toBe(1);
      expectTimelineChronological(place.timeline);
      expect(getTimelineYears(place.timeline)).toEqual([1900, 2010]);
    });

    it("incorrect placement: should be in middle but player places at beginning → event moved to correct position", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e1", "e6"]);
      await setCurrentPlayerHand(roomId, ["e3", "e4", "e5"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e3", 0);
      expect("error" in result).toBe(false);
      const place = result as { correct: boolean; timeline: TimelineEntry[]; correctPosition: number };
      expect(place.correct).toBe(false);
      expect(place.correctPosition).toBe(1);
      expectTimelineChronological(place.timeline);
      expect(getTimelineYears(place.timeline)).toEqual([1900, 1950, 2000]);
    });

    it("incorrect placement: should be in middle but player places at end → event moved to correct position", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e1", "e6"]);
      await setCurrentPlayerHand(roomId, ["e3", "e4", "e5"]);

      const state = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const result = await placeEvent(roomId, state.currentTurnPlayerId!, "e3", 2);
      expect("error" in result).toBe(false);
      const place = result as { correct: boolean; timeline: TimelineEntry[]; correctPosition: number };
      expect(place.correct).toBe(false);
      expect(place.correctPosition).toBe(1);
      expectTimelineChronological(place.timeline);
      expect(getTimelineYears(place.timeline)).toEqual([1900, 1950, 2000]);
    });

    it("two incorrect placements in a row (different players): timeline stays chronological", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string };
      const p2Id = join.playerId;
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e4"]);
      await setCurrentPlayerHand(roomId, ["e1", "e2", "e3"]);

      const state1 = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const r1 = await placeEvent(roomId, state1.currentTurnPlayerId!, "e1", 1);
      expect("error" in r1).toBe(false);
      expect((r1 as { correct: boolean }).correct).toBe(false);
      expectTimelineChronological((r1 as { timeline: TimelineEntry[] }).timeline);

      await setCurrentPlayerHand(roomId, ["e8", "e7", "e6"]);
      const state2 = (await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!))!;
      const r2 = await placeEvent(roomId, state2.currentTurnPlayerId!, "e8", 0);
      expect("error" in r2).toBe(false);
      expect((r2 as { correct: boolean }).correct).toBe(false);
      expectTimelineChronological((r2 as { timeline: TimelineEntry[] }).timeline);
      expect(getTimelineYears((r2 as { timeline: TimelineEntry[] }).timeline)).toEqual([1900, 1975, 2010]);
    });

    it("correct then incorrect then correct: timeline always chronological", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host", undefined, { maxTimelineSize: 8 });
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e4"]);
      await setCurrentPlayerHand(roomId, ["e1", "e2", "e3"]);

      const r1 = await placeEvent(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!, "e1", 0);
      expect("error" in r1).toBe(false);
      expect((r1 as { correct: boolean }).correct).toBe(true);
      expectTimelineChronological((r1 as { timeline: TimelineEntry[] }).timeline);

      await setCurrentPlayerHand(roomId, ["e8", "e7", "e6"]);
      const r2 = await placeEvent(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!, "e8", 0);
      expect("error" in r2).toBe(false);
      expect((r2 as { correct: boolean }).correct).toBe(false);
      expectTimelineChronological((r2 as { timeline: TimelineEntry[] }).timeline);

      await setCurrentPlayerHand(roomId, ["e5", "e6", "e7"]);
      const r3 = await placeEvent(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!, "e5", 2);
      expect("error" in r3).toBe(false);
      expect((r3 as { correct: boolean }).correct).toBe(true);
      expectTimelineChronological((r3 as { timeline: TimelineEntry[] }).timeline);
    });

    it("long sequence: correct, incorrect, incorrect, correct, incorrect → timeline always chronological", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host", undefined, { maxTimelineSize: 12 });
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      await setTimelineToEventIds(roomId, ["e6"]);

      const placements: { hand: string[]; position: number; expectCorrect: boolean }[] = [
        { hand: ["e1", "e2", "e3"], position: 0, expectCorrect: true },
        { hand: ["e8", "e7", "e5"], position: 0, expectCorrect: false },
        { hand: ["e4", "e3", "e2"], position: 3, expectCorrect: false },
        { hand: ["e5", "e7", "e8"], position: 2, expectCorrect: true },
        { hand: ["e2", "e3", "e4"], position: 0, expectCorrect: false },
      ];

      for (const { hand, position, expectCorrect } of placements) {
        await setCurrentPlayerHand(roomId, hand);
        const state = await getRoomState(roomId, (await getRoomState(roomId))!.currentTurnPlayerId!);
        if (!state || state.myHand.length === 0) break;
        const eventId = state.myHand[0]!.id;
        const result = await placeEvent(roomId, state.currentTurnPlayerId!, eventId, position);
        expect("error" in result).toBe(false);
        expect((result as { correct: boolean }).correct).toBe(expectCorrect);
        expectTimelineChronological((result as { timeline: TimelineEntry[] }).timeline);
      }

      expectTimelineChronological((await getRoomState(roomId))!.timeline);
    });
  });

  it("endGame returns room to lobby with no winner", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    await joinRoom(roomId, "P2");
    await startGame(roomId, hostId);

    const result = await endGame(roomId, hostId);
    expect("error" in result).toBe(false);
    const state = result as RoomStateResolved;
    expect(state.status).toBe("lobby");
    expect(state.winnerPlayerId).toBeNull();
    expect(state.timeline).toHaveLength(0);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
  });

  it("endGame returns error when not host", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const join = await joinRoom(roomId, "P2") as { playerId: string };
    await startGame(roomId, hostId);

    const result = await endGame(roomId, join.playerId);
    expect(result).toEqual({ error: "Only the host can end the game" });
  });

  it("endGame returns error when room not found", async () => {
    const result = await endGame("non-existent-room-id", "some-player-id");
    expect(result).toEqual({ error: "Room not found" });
  });

  it("endGame returns error when game is not in progress", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const result = await endGame(roomId, hostId);
    expect(result).toEqual({ error: "Game is not in progress" });
  });

  it("rematchRoom resets to lobby when host requests after game ended", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    await joinRoom(roomId, "P2");
    await startGame(roomId, hostId);
    liveRoomTestHelpers.forceMatchEnded(roomId, hostId);

    const result = await rematchRoom(roomId, hostId);
    expect("error" in result).toBe(false);
    const state = result as RoomStateResolved;
    expect(state.status).toBe("lobby");
    expect(state.timeline).toHaveLength(0);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
  });

  it("rematchRoom returns error when game not ended", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    await joinRoom(roomId, "P2");
    await startGame(roomId, hostId);

    const result = await rematchRoom(roomId, hostId);
    expect(result).toEqual({ error: "Game is not finished" });
  });

  it("rematchRoom returns error when room not found", async () => {
    const result = await rematchRoom("non-existent-room-id", "some-host-id");
    expect(result).toEqual({ error: "Room not found" });
  });

  it("rematchRoom returns error when not enough players for revanche", async () => {
    const { roomId, playerId: hostId } = await createRoom("Host");
    const join = await joinRoom(roomId, "P2") as { playerId: string };
    const p2Id = join.playerId;
    await startGame(roomId, hostId);
    liveRoomTestHelpers.forceMatchEnded(roomId, hostId);
    await setPlayerConnected(roomId, p2Id, false);

    const result = await rematchRoom(roomId, hostId);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("2 players");
  });

  describe("leaveRoom", () => {
    it("in lobby: non-host leaves and is removed from players", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string; roomState: RoomStateResolved };
      const p2Id = join.playerId;
      expect(join.roomState.players).toHaveLength(2);

      const result = await leaveRoom(roomId, p2Id);
      expect("error" in result).toBe(false);
      const { roomState, leftPlayerNickname } = result as {
        roomState: RoomStateResolved;
        leftPlayerNickname: string;
      };
      expect(leftPlayerNickname).toBe("P2");
      expect(roomState.players).toHaveLength(1);
      expect(roomState.players[0]?.playerId).toBe(hostId);
      expect(roomState.status).toBe("lobby");
    });

    it("returns error when host tries to leave", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");

      const result = await leaveRoom(roomId, hostId);
      expect(result).toEqual({
        error: "Host cannot leave; use End game to return to lobby",
      });
    });

    it("returns error when room not found", async () => {
      const result = await leaveRoom("non-existent-room-id", "some-player-id");
      expect(result).toEqual({ error: "Room not found" });
    });

    it("returns error when player not in room", async () => {
      const { roomId } = await createRoom("Host");
      const result = await leaveRoom(roomId, "other-player-id");
      expect(result).toEqual({ error: "Player not in room" });
    });

    it("during game with 2 players: non-host leaves and room resets to lobby", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string };
      const p2Id = join.playerId;
      await startGame(roomId, hostId);

      const result = await leaveRoom(roomId, p2Id);
      expect("error" in result).toBe(false);
      const { roomState } = result as {
        roomState: RoomStateResolved;
        leftPlayerNickname: string;
      };
      expect(roomState.status).toBe("lobby");
      expect(roomState.players).toHaveLength(1);
      expect(roomState.players[0]?.playerId).toBe(hostId);
      expect(roomState.timeline).toHaveLength(0);
    });

    it("during game with 3 players: leaver not on turn leaves, turn unchanged", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const j2 = await joinRoom(roomId, "A") as { playerId: string };
      const j3 = await joinRoom(roomId, "B") as { playerId: string };
      const idA = j2.playerId;
      const idB = j3.playerId;
      await startGame(roomId, hostId);

      // Force turn order: host first, then A, then B. Leaver will be A or B (non-host, not current).
      liveRoomTestHelpers.setTurnOrder(roomId, [hostId, idA, idB], 0);

      const stateBefore = (await getRoomState(roomId))!;
      const currentId = stateBefore.currentTurnPlayerId!;
      expect(currentId).toBe(hostId);
      const leaverId = [idA, idB].find((id) => id !== currentId)!;

      const result = await leaveRoom(roomId, leaverId);
      expect("error" in result).toBe(false);
      const stateAfter = (await getRoomState(roomId))!;
      expect(stateAfter.players).toHaveLength(2);
      expect(stateAfter.currentTurnPlayerId).toBe(currentId);
    });

    it("during game with 3 players: leaver on turn leaves, turn advances to next", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const j2 = await joinRoom(roomId, "A") as { playerId: string };
      const j3 = await joinRoom(roomId, "B") as { playerId: string };
      const idA = j2.playerId;
      const idB = j3.playerId;
      await startGame(roomId, hostId);

      // Force turn order so a non-host has the turn (host cannot leave)
      liveRoomTestHelpers.setTurnOrder(roomId, [idA, hostId, idB], 0);

      const stateBefore = (await getRoomState(roomId))!;
      const currentId = stateBefore.currentTurnPlayerId!;
      expect(currentId).toBe(idA);
      const orderedIds = stateBefore.turnOrder;
      const currentIndex = orderedIds.indexOf(currentId);
      const nextId = orderedIds[(currentIndex + 1) % orderedIds.length];

      const result = await leaveRoom(roomId, currentId);
      expect("error" in result).toBe(false);
      const stateAfter = (await getRoomState(roomId))!;
      expect(stateAfter.players).toHaveLength(2);
      expect(stateAfter.currentTurnPlayerId).toBe(nextId);
    });
  });

  describe("streak", () => {
    it("startGame sets all player streaks to 0", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      const st = (await startGame(roomId, hostId)) as RoomStateResolved;
      for (const p of st.players) {
        expect(p.streak).toBe(0);
      }
    });

    it("correct placement increments only the acting player's streak", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string };
      const p2 = join.playerId;
      await startGame(roomId, hostId);
      const cur = (await getRoomState(roomId))!.currentTurnPlayerId!;
      const s = (await getRoomState(roomId, cur))!;
      const ev = s.myHand[0]!;
      const timelineYears = s.timeline.map((t) => t.event.year);
      const pos = findCorrectPosition(timelineYears, ev.year);
      const r = await placeEvent(roomId, cur, ev.id, pos);
      expect("error" in r).toBe(false);
      const place = r as { streak: number };
      expect(place.streak).toBe(1);
      const after = (await getRoomState(roomId))!;
      const otherId = cur === hostId ? p2 : hostId;
      expect(after.players.find((p) => p.playerId === cur)!.streak).toBe(1);
      expect(after.players.find((p) => p.playerId === otherId)!.streak).toBe(0);
    });

    it("incorrect placement resets only the acting player's streak", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string };
      const p2 = join.playerId;
      await startGame(roomId, hostId);
      const cur = (await getRoomState(roomId))!.currentTurnPlayerId!;
      const otherId = cur === hostId ? p2 : hostId;
      liveRoomTestHelpers.setPlayerStreak(roomId, cur, 3);
      liveRoomTestHelpers.setPlayerStreak(roomId, otherId, 5);
      const s = (await getRoomState(roomId, cur))!;
      const ev = s.myHand[0]!;
      const timelineYears = s.timeline.map((t) => t.event.year);
      const correctPos = findCorrectPosition(timelineYears, ev.year);
      const wrongPos = correctPos === 0 ? 1 : 0;
      const r = await placeEvent(roomId, cur, ev.id, wrongPos);
      expect("error" in r).toBe(false);
      const place = r as { correct: boolean; streak: number };
      expect(place.correct).toBe(false);
      expect(place.streak).toBe(0);
      const after = (await getRoomState(roomId))!;
      expect(after.players.find((p) => p.playerId === cur)!.streak).toBe(0);
      expect(after.players.find((p) => p.playerId === otherId)!.streak).toBe(5);
    });

    it("rematch clears all streaks", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      liveRoomTestHelpers.setAllPlayerStreaks(roomId, 4);
      liveRoomTestHelpers.forceMatchEnded(roomId, hostId);
      const rm = await rematchRoom(roomId, hostId);
      expect("error" in rm).toBe(false);
      const st = rm as RoomStateResolved;
      for (const p of st.players) {
        expect(p.streak).toBe(0);
      }
    });

    it("leave causing lobby reset clears streaks for remaining players", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string };
      const p2 = join.playerId;
      await startGame(roomId, hostId);
      liveRoomTestHelpers.setAllPlayerStreaks(roomId, 7);
      const res = await leaveRoom(roomId, p2);
      expect("error" in res).toBe(false);
      const lobby = (res as { roomState: RoomStateResolved }).roomState;
      expect(lobby.status).toBe("lobby");
      expect(lobby.players).toHaveLength(1);
      expect(lobby.players[0]?.streak).toBe(0);
    });

    it("endGame clears all streaks", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      liveRoomTestHelpers.setAllPlayerStreaks(roomId, 6);
      const eg = await endGame(roomId, hostId);
      expect("error" in eg).toBe(false);
      const st = eg as RoomStateResolved;
      for (const p of st.players) {
        expect(p.streak).toBe(0);
      }
    });
  });

  describe("closeRoomPermanently", () => {
    it("host closes room from lobby: room is deleted and getRoomState returns null", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      expect(await getRoomState(roomId)).not.toBeNull();

      const result = await closeRoomPermanently(roomId, hostId);
      expect(result).toEqual({ ok: true });
      expect(await getRoomState(roomId)).toBeNull();
    });

    it("returns error when non-host tries to close room", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      const join = await joinRoom(roomId, "P2") as { playerId: string };
      const p2Id = join.playerId;

      const result = await closeRoomPermanently(roomId, p2Id);
      expect(result).toEqual({ error: "Only the host can close the room" });
      expect(await getRoomState(roomId)).not.toBeNull();
    });

    it("returns error when room not found", async () => {
      const result = await closeRoomPermanently("non-existent-room-id", "some-player-id");
      expect(result).toEqual({ error: "Room not found" });
    });

    it("host can close room when status is ended", async () => {
      const { roomId, playerId: hostId } = await createRoom("Host");
      await joinRoom(roomId, "P2");
      await startGame(roomId, hostId);
      liveRoomTestHelpers.forceMatchEnded(roomId, hostId);

      const result = await closeRoomPermanently(roomId, hostId);
      expect(result).toEqual({ ok: true });
      expect(await getRoomState(roomId)).toBeNull();
    });
  });
});
