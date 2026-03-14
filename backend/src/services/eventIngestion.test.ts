import { describe, it, expect } from "vitest";
import {
  mergeWithExistingPool,
  LIMIT_PER_CATEGORY,
  type IngestedEvent,
  type PoolEventLike,
} from "./eventIngestion.js";

function ev(
  id: string,
  type: string,
  overrides: Partial<IngestedEvent> = {},
): IngestedEvent {
  return {
    id,
    title: `Title ${id}`,
    type,
    displayTitle: `Title ${id} (${type})`,
    year: 2000,
    image: "https://example.com/img.jpg",
    wikipediaUrl: "https://en.wikipedia.org/wiki/X",
    ...overrides,
  };
}

describe("eventIngestion", () => {
  describe("mergeWithExistingPool", () => {
    it("returns existing when no candidates", () => {
      const existing: PoolEventLike[] = [
        { id: "1", type: "Film", title: "A", displayTitle: "A (Film)", year: 1990, image: "x", wikipediaUrl: "y" },
      ];
      expect(mergeWithExistingPool(existing, [])).toHaveLength(1);
      expect(mergeWithExistingPool(existing, [])[0]?.id).toBe("1");
    });

    it("adds new candidates when under limit", () => {
      const existing: PoolEventLike[] = [
        { id: "1", type: "Film", title: "A", displayTitle: "A (Film)", year: 1990, image: "x", wikipediaUrl: "y" },
      ];
      const candidates = [ev("2", "Film"), ev("3", "Film")];
      const merged = mergeWithExistingPool(existing, candidates, 10);
      expect(merged).toHaveLength(3);
      expect(merged.map((e) => e.id).sort()).toEqual(["1", "2", "3"]);
    });

    it("skips candidates that already exist by id", () => {
      const existing: PoolEventLike[] = [
        { id: "1", type: "Film", title: "A", displayTitle: "A (Film)", year: 1990, image: "x", wikipediaUrl: "y" },
      ];
      const candidates = [ev("1", "Film", { title: "Updated" }), ev("2", "Film")];
      const merged = mergeWithExistingPool(existing, candidates, 10);
      expect(merged).toHaveLength(2);
      expect(merged.find((e) => e.id === "1")?.title).toBe("A");
      expect(merged.find((e) => e.id === "2")).toBeDefined();
    });

    it("replaces random event in category when at limit", () => {
      const existing: PoolEventLike[] = Array.from({ length: 3 }, (_, i) => ({
        id: `old-${i}`,
        type: "Film",
        title: `Old ${i}`,
        displayTitle: `Old ${i} (Film)`,
        year: 1990 + i,
        image: "x",
        wikipediaUrl: "y",
      }));
      const candidates = [ev("new-1", "Film")];
      const limit = 3;
      const merged = mergeWithExistingPool(existing, candidates, limit);
      expect(merged).toHaveLength(3);
      const ids = merged.map((e) => e.id);
      expect(ids).toContain("new-1");
      const oldCount = ids.filter((id) => id.startsWith("old-")).length;
      expect(oldCount).toBe(2);
    });

    it("uses custom limitPerCategory", () => {
      const existing: PoolEventLike[] = [
        { id: "1", type: "Book", title: "A", displayTitle: "A (Book)", year: 2000, image: "x", wikipediaUrl: "y" },
      ];
      const candidates = [ev("2", "Book"), ev("3", "Book")];
      const merged = mergeWithExistingPool(existing, candidates, 2);
      expect(merged).toHaveLength(2);
    });

    it("handles multiple categories independently", () => {
      const existing: PoolEventLike[] = [
        { id: "f1", type: "Film", title: "F1", displayTitle: "F1 (Film)", year: 2000, image: "x", wikipediaUrl: "y" },
        { id: "b1", type: "Book", title: "B1", displayTitle: "B1 (Book)", year: 2000, image: "x", wikipediaUrl: "y" },
      ];
      const candidates = [ev("f2", "Film"), ev("b2", "Book")];
      const merged = mergeWithExistingPool(existing, candidates, 10);
      expect(merged).toHaveLength(4);
      expect(merged.filter((e) => e.type === "Film")).toHaveLength(2);
      expect(merged.filter((e) => e.type === "Book")).toHaveLength(2);
    });
  });
});
