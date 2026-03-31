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

/** Last successfully placed event (for "just placed" UI). */
export type LastPlacedEvent = {
  eventId: string;
  title: string;
  year: number;
  image: string | null;
  placedByPlayerId: string;
};

export type RoomPlayer = {
  playerId: string;
  nickname: string;
  avatar?: string | null;
  isHost: boolean;
  score: number;
  /** Consecutive correct placements this match; resets on wrong placement or room reset. */
  streak: number;
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
  /** Current player's hand (3 cards). Only present for the requesting player; others do not see card details. */
  myHand: ApiEvent[];
  nextDeckSequence: number;
  initialEventId: string | null;
  endedAt: string | null;
  winnerPlayerId: string | null;
  /** Most recently placed event (by any player); for "last placed" card and timeline highlight. */
  lastPlacedEvent: LastPlacedEvent | null;
};
