import { describe, it, expect } from "vitest";
import { validatePlace, getNextTurnPlayerId } from "./validation.js";

describe("validation", () => {
  const turnOrder = ["player1", "player2", "player3"];
  const timelineYears = [1900, 1950, 2000];

  describe("validatePlace", () => {
    const baseCtx = {
      currentTurnPlayerId: "player2",
      turnOrder,
      turnIndex: 1,
      handEventIds: new Set(["event-123"]),
      timelineYears,
      timelineLength: 3,
      maxTimelineSize: 50,
      pointsToWin: 2,
      currentPlayerScore: 0,
    };

    it("returns error when not player turn", () => {
      const result = validatePlace(
        "player1",
        "event-123",
        2,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        baseCtx,
      );
      expect(result).toEqual({ valid: false, error: "Not your turn" });
    });

    it("returns error when event not in hand", () => {
      const result = validatePlace(
        "player2",
        "other-event",
        2,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        baseCtx,
      );
      expect(result).toEqual({ valid: false, error: "Event not in your hand" });
    });

    it("returns error when hand is empty for event", () => {
      const result = validatePlace(
        "player2",
        "event-123",
        2,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        { ...baseCtx, handEventIds: new Set() },
      );
      expect(result).toEqual({ valid: false, error: "Event not in your hand" });
    });

    it("returns error when position is invalid", () => {
      const result = validatePlace(
        "player2",
        "event-123",
        -1,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        baseCtx,
      );
      expect(result).toEqual({ valid: false, error: "Invalid position" });
    });

    it("returns error when position exceeds timeline length", () => {
      const result = validatePlace(
        "player2",
        "event-123",
        10,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        { ...baseCtx, timelineLength: 3 },
      );
      expect(result).toEqual({ valid: false, error: "Invalid position" });
    });

    it("returns valid true and correct true when placement is chronologically correct", () => {
      const result = validatePlace(
        "player2",
        "event-123",
        2,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        baseCtx,
      );
      expect(result).toEqual({ valid: true, correct: true, correctPosition: 2 });
    });

    it("returns valid true and correct false with correctPosition when placement is wrong", () => {
      const result = validatePlace(
        "player2",
        "event-123",
        0,
        { year: 1975, title: "X", image: "x", wikipediaUrl: "x" },
        baseCtx,
      );
      expect(result.valid).toBe(true);
      expect((result as { correct: boolean }).correct).toBe(false);
      expect((result as { correctPosition: number }).correctPosition).toBe(2);
    });

    it("returns correctPosition at end when placement wrong and event year after all", () => {
      const result = validatePlace(
        "player2",
        "event-123",
        1,
        { year: 2500, title: "X", image: "x", wikipediaUrl: "x" },
        { ...baseCtx, timelineYears: [1900, 1950, 2000], timelineLength: 3 },
      );
      expect(result.valid).toBe(true);
      expect((result as { correct: boolean }).correct).toBe(false);
      expect((result as { correctPosition: number }).correctPosition).toBe(3);
    });
  });

  describe("getNextTurnPlayerId", () => {
    it("returns next player in order", () => {
      expect(getNextTurnPlayerId(["a", "b", "c"], 0)).toBe("b");
      expect(getNextTurnPlayerId(["a", "b", "c"], 1)).toBe("c");
      expect(getNextTurnPlayerId(["a", "b", "c"], 2)).toBe("a");
    });

    it("returns null for empty turn order", () => {
      expect(getNextTurnPlayerId([], 0)).toBe(null);
    });

    it("wraps around for single player", () => {
      expect(getNextTurnPlayerId(["a"], 0)).toBe("a");
    });
  });
});
