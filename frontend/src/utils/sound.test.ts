import { describe, it, expect } from "vitest";
import {
  playSound,
  stopTickSound,
  playJoinSound,
  playStartGameSound,
} from "./sound";

describe("sound utils", () => {
  it("exports playSound", () => {
    expect(typeof playSound).toBe("function");
  });

  it("exports stopTickSound", () => {
    expect(typeof stopTickSound).toBe("function");
  });

  it("exports playJoinSound", () => {
    expect(typeof playJoinSound).toBe("function");
  });

  it("exports playStartGameSound", () => {
    expect(typeof playStartGameSound).toBe("function");
  });

  it("playSound does not throw for any valid type (no Audio in Node)", () => {
    expect(() => playSound("correct")).not.toThrow();
    expect(() => playSound("wrong")).not.toThrow();
    expect(() => playSound("victory")).not.toThrow();
    expect(() => playSound("defeat")).not.toThrow();
    expect(() => playSound("tick")).not.toThrow();
  });

  it("stopTickSound does not throw", () => {
    expect(() => stopTickSound()).not.toThrow();
  });

  it("playJoinSound does not throw", () => {
    expect(() => playJoinSound()).not.toThrow();
  });

  it("playStartGameSound does not throw", () => {
    expect(() => playStartGameSound()).not.toThrow();
  });
});
