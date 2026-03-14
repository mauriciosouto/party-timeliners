/**
 * Canonical game state types. Single source of truth for frontend and backend.
 */

export type RoomStatus = "lobby" | "playing" | "ended";

export type ApiEvent = {
  id: string;
  title: string;
  year: number;
  displayTitle: string;
  image?: string;
  wikipediaUrl?: string;
};

export type TimelineEntry = {
  event: ApiEvent;
  position: number;
  placedByPlayerId?: string | null;
  placedAt?: string;
};

export type RoomPlayer = {
  playerId: string;
  nickname: string;
  isHost: boolean;
  score: number;
  turnOrder: number | null;
  connected: boolean;
  joinedAt: string;
};

/** Full room/game state. Backend is the single source of truth. */
export type GameState = {
  roomId: string;
  name: string;
  status: RoomStatus;
  hostPlayerId: string | null;
  maxTimelineSize: number | null;
  pointsToWin: number | null;
  turnTimeLimitSeconds: number | null;
  players: RoomPlayer[];
  timeline: TimelineEntry[];
  scores: Record<string, number>;
  turnOrder: string[];
  currentTurnPlayerId: string | null;
  currentTurnStartedAt: string | null;
  nextDeckSequence: number;
  initialEventId: string | null;
  endedAt: string | null;
  winnerPlayerId: string | null;
};
