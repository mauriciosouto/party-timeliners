import { describe, it, expect } from "vitest";
import { isGoodEvent, filterGoodEvents } from "./eventQuality.js";

describe("eventQuality", () => {
  const baseEvent = {
    title: "Apollo 11",
    year: 1969,
    image: "https://example.com/img.jpg",
    wikipediaUrl: "https://en.wikipedia.org/wiki/Apollo_11",
  };

  describe("isGoodEvent", () => {
    it("returns true for a valid event", () => {
      expect(isGoodEvent(baseEvent)).toBe(true);
    });

    it("returns false when title is missing or too short", () => {
      expect(isGoodEvent({ ...baseEvent, title: "" })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, title: "   " })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, title: "Ab" })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, title: "1234" })).toBe(false);
    });

    it("returns false when title is too long", () => {
      expect(isGoodEvent({ ...baseEvent, title: "a".repeat(121) })).toBe(false);
    });

    it("returns false when year is invalid", () => {
      expect(isGoodEvent({ ...baseEvent, year: NaN })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, year: undefined as unknown as number })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, year: (new Date().getUTCFullYear() + 1) as number })).toBe(false);
    });

    it("returns false when wikipediaUrl is missing", () => {
      expect(isGoodEvent({ ...baseEvent, wikipediaUrl: "" })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, wikipediaUrl: undefined })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, wikipedia_url: "https://en.wikipedia.org/wiki/X" })).toBe(true);
    });

    it("returns false when image is missing", () => {
      expect(isGoodEvent({ ...baseEvent, image: "" })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, image: undefined })).toBe(false);
    });

    it("returns false when title contains a year range", () => {
      expect(isGoodEvent({ ...baseEvent, title: "Something 1980-01" })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, title: "Something 1999–12" })).toBe(false);
    });

    it("returns false when title contains a standalone year", () => {
      expect(isGoodEvent({ ...baseEvent, title: "Event in 1969" })).toBe(false);
      expect(isGoodEvent({ ...baseEvent, title: "2020 Conference" })).toBe(false);
    });

    it("accepts wikipedia_url as alias for wikipediaUrl", () => {
      expect(
        isGoodEvent({
          ...baseEvent,
          wikipediaUrl: undefined,
          wikipedia_url: "https://en.wikipedia.org/wiki/Test",
        }),
      ).toBe(true);
    });
  });

  describe("filterGoodEvents", () => {
    it("returns only events that pass isGoodEvent when at least one passes", () => {
      const events = [
        { ...baseEvent, id: "1" },
        { ...baseEvent, id: "2", title: "X" },
        { ...baseEvent, id: "3", year: 2000 },
      ];
      const filtered = filterGoodEvents(events);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((e) => (e as { id: string }).id)).toEqual(["1", "3"]);
    });

    it("returns all events when none pass (fallback)", () => {
      const events = [
        { ...baseEvent, id: "1", title: "X" },
        { ...baseEvent, id: "2", title: "Y" },
      ];
      const filtered = filterGoodEvents(events);
      expect(filtered).toHaveLength(2);
      expect(filtered).toEqual(events);
    });

    it("returns empty array when input is empty", () => {
      expect(filterGoodEvents([])).toEqual([]);
    });
  });
});
