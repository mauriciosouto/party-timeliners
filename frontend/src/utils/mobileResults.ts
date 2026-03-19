export type PlayerSummary = {
  playerId: string;
  nickname: string;
  score?: number | null;
};

export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function getPodiumCount(playerCount: number): number {
  return playerCount <= 3 ? 1 : playerCount <= 5 ? 2 : 3;
}

export function sortPlayersByScore(players: PlayerSummary[]): PlayerSummary[] {
  return [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function getMobileResultsGroups(players: PlayerSummary[], winnerPlayerId: string | null) {
  const rankedPlayers = sortPlayersByScore(players);
  const playerCount = rankedPlayers.length;
  const podiumCount = getPodiumCount(playerCount);
  const podiumPlayers = rankedPlayers.slice(0, podiumCount);
  const restRanked = rankedPlayers.slice(podiumCount);
  const podiumExtraPlayers = winnerPlayerId ? podiumPlayers.slice(1) : [];

  return {
    rankedPlayers,
    podiumCount,
    podiumPlayers,
    restRanked,
    podiumExtraPlayers,
  };
}

