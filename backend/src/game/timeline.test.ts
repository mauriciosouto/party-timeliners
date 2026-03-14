import { describe, it, expect } from "vitest";
import {
  isValidPosition,
  findCorrectPosition,
  isCorrectPlacement,
} from "./timeline.js";

describe("timeline", () => {
  describe("isValidPosition", () => {
    it("returns true for 0 and timelineLength", () => {
      expect(isValidPosition(0, 0)).toBe(true);
      expect(isValidPosition(0, 5)).toBe(true);
      expect(isValidPosition(5, 5)).toBe(true);
      expect(isValidPosition(3, 3)).toBe(true);
    });

    it("returns true for positions in between", () => {
      expect(isValidPosition(1, 5)).toBe(true);
      expect(isValidPosition(2, 5)).toBe(true);
      expect(isValidPosition(4, 5)).toBe(true);
    });

    it("returns false for negative position", () => {
      expect(isValidPosition(-1, 5)).toBe(false);
    });

    it("returns false for position > timelineLength", () => {
      expect(isValidPosition(6, 5)).toBe(false);
      expect(isValidPosition(10, 5)).toBe(false);
    });

    it("returns false for non-integer or non-number", () => {
      expect(isValidPosition(1.5, 5)).toBe(false);
      expect(isValidPosition(NaN, 5)).toBe(false);
    });
  });

  describe("findCorrectPosition", () => {
    it("returns 0 when event is before all", () => {
      expect(findCorrectPosition([1000, 2000, 3000], 500)).toBe(0);
    });

    it("returns length when event is after all", () => {
      expect(findCorrectPosition([1000, 2000], 3000)).toBe(2);
      expect(findCorrectPosition([], 1000)).toBe(0);
    });

    it("returns correct insert index in the middle", () => {
      expect(findCorrectPosition([1000, 2000, 3000], 1500)).toBe(1);
      expect(findCorrectPosition([1000, 2000, 3000], 2500)).toBe(2);
    });

    it("inserts before first year greater than event", () => {
      expect(findCorrectPosition([1000, 2000, 3000], 2000)).toBe(2);
    });
  });

  describe("isCorrectPlacement", () => {
    const years = [1000, 2000, 3000];

    it("returns true when position is chronologically correct", () => {
      expect(isCorrectPlacement(years, 0, 500)).toBe(true);
      expect(isCorrectPlacement(years, 0, 1000)).toBe(true);
      expect(isCorrectPlacement(years, 1, 1500)).toBe(true);
      expect(isCorrectPlacement(years, 1, 2000)).toBe(true);
      expect(isCorrectPlacement(years, 2, 2500)).toBe(true);
      expect(isCorrectPlacement(years, 3, 3500)).toBe(true);
      expect(isCorrectPlacement(years, 3, 3000)).toBe(true);
    });

    it("returns false when position is wrong", () => {
      expect(isCorrectPlacement(years, 0, 1500)).toBe(false);
      expect(isCorrectPlacement(years, 1, 500)).toBe(false);
      expect(isCorrectPlacement(years, 1, 3500)).toBe(false);
      expect(isCorrectPlacement(years, 2, 1500)).toBe(false);
      expect(isCorrectPlacement(years, 3, 2500)).toBe(false);
    });

    it("works for empty timeline", () => {
      expect(isCorrectPlacement([], 0, 2000)).toBe(true);
    });
  });
});
