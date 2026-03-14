import { describe, it, expect } from "vitest";
import { shuffle, buildDeck } from "./deck.js";

describe("deck", () => {
  const goodEvent = {
    id: "e1",
    title: "Apollo 11",
    year: 1969,
    image: "https://x/img.jpg",
    wikipediaUrl: "https://en.wikipedia.org/wiki/Apollo_11",
  };
  const badEvent = {
    id: "e2",
    title: "X",
    year: 2000,
    image: "https://x/img.jpg",
    wikipediaUrl: "https://en.wikipedia.org/wiki/X",
  };

  describe("shuffle", () => {
    it("returns array of same length", () => {
      const arr = [1, 2, 3, 4, 5];
      expect(shuffle(arr)).toHaveLength(5);
    });

    it("returns array with same elements", () => {
      const arr = [1, 2, 3, 4, 5];
      const result = shuffle(arr);
      expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it("does not mutate input", () => {
      const arr = [1, 2, 3];
      shuffle(arr);
      expect(arr).toEqual([1, 2, 3]);
    });
  });

  describe("buildDeck", () => {
    it("returns at most size events", () => {
      const pool = [goodEvent, { ...goodEvent, id: "e3" }, { ...goodEvent, id: "e4" }];
      const deck = buildDeck(pool, 2);
      expect(deck).toHaveLength(2);
    });

    it("excludes event IDs in excludeIds", () => {
      const pool = [
        { ...goodEvent, id: "a" },
        { ...goodEvent, id: "b" },
        { ...goodEvent, id: "c" },
      ];
      const deck = buildDeck(pool, 10, new Set(["b"]));
      expect(deck.map((e) => e.id)).not.toContain("b");
      expect(deck).toHaveLength(2);
    });

    it("prefers quality events when available", () => {
      const pool = [badEvent, goodEvent, { ...goodEvent, id: "e3" }];
      const deck = buildDeck(pool, 2);
      expect(deck.every((e) => e.title.length >= 5)).toBe(true);
      expect(deck).toHaveLength(2);
    });

    it("falls back to all when no quality events", () => {
      const pool = [
        { ...badEvent, id: "a" },
        { ...badEvent, id: "b" },
      ];
      const deck = buildDeck(pool, 2);
      expect(deck).toHaveLength(2);
    });

    it("returns empty when pool is empty or all excluded", () => {
      expect(buildDeck([], 5)).toEqual([]);
      const pool = [{ ...goodEvent, id: "a" }];
      expect(buildDeck(pool, 5, new Set(["a"]))).toEqual([]);
    });
  });
});
