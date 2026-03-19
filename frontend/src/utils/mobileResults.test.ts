import { describe, it, expect } from "vitest";
import {
  getMobileResultsGroups,
  getPodiumCount,
  ordinal,
  type PlayerSummary,
} from "./mobileResults";

const players = (scores: number[]): PlayerSummary[] =>
  scores.map((score, idx) => ({
    playerId: `p${idx + 1}`,
    nickname: `Player ${idx + 1}`,
    score,
  }));

describe("mobileResults utils", () => {
  it("ordinal formats suffix correctly", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(10)).toBe("10th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(24)).toBe("24th");
  });

  it("getPodiumCount matches player count rules", () => {
    expect(getPodiumCount(1)).toBe(1);
    expect(getPodiumCount(2)).toBe(1);
    expect(getPodiumCount(3)).toBe(1);
    expect(getPodiumCount(4)).toBe(2);
    expect(getPodiumCount(5)).toBe(2);
    expect(getPodiumCount(6)).toBe(3);
    expect(getPodiumCount(10)).toBe(3);
  });

  it("groups results: ranks, podium, and rest", () => {
    const ps = players([5, 10, 7, 1, 3]); // sorted desc: 10,7,5,3,1
    const winnerPlayerId = "p2"; // score 10
    const { rankedPlayers, podiumCount, podiumPlayers, restRanked, podiumExtraPlayers } =
      getMobileResultsGroups(ps, winnerPlayerId);

    expect(rankedPlayers.map((p) => p.playerId)).toEqual(["p2", "p3", "p1", "p5", "p4"]);
    expect(podiumCount).toBe(2); // 5 players => 2
    expect(podiumPlayers.map((p) => p.playerId)).toEqual(["p2", "p3"]);
    expect(restRanked.map((p) => p.playerId)).toEqual(["p1", "p5", "p4"]);

    // podiumExtraPlayers: only additional podium spots beyond winner
    expect(podiumExtraPlayers.map((p) => p.playerId)).toEqual(["p3"]);
  });

  it("groups results: podiumExtraPlayers empty on tie (no winner)", () => {
    const ps = players([5, 10, 7]); // 3 players => podiumCount 1
    const { podiumExtraPlayers } = getMobileResultsGroups(ps, null);
    expect(podiumExtraPlayers).toEqual([]);
  });
});

