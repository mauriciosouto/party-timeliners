export type RoomStatus = "lobby" | "playing" | "ended";

export type EventRecord = {
  id: string;
  title: string;
  type: string;
  display_title: string;
  year: number;
  image: string | null;
  wikipedia_url: string | null;
  popularity_score?: number | null;
};

/** API: event as returned to client */
export type ApiEvent = {
  id: string;
  title: string;
  year: number;
  displayTitle: string;
  image?: string;
  wikipediaUrl?: string;
};

/** API: timeline entry with optional placedBy */
export type ApiTimelineEntry = {
  event: ApiEvent;
  position: number;
  placedByPlayerId?: string | null;
  placedAt?: string;
};

export type RoomPlayerState = {
  playerId: string;
  nickname: string;
  avatar?: string | null;
  isHost: boolean;
  score: number;
  turnOrder: number | null;
  connected: boolean;
  joinedAt: string;
};

export type RoomState = {
  roomId: string;
  name: string;
  status: RoomStatus;
  hostPlayerId: string | null;
  maxTimelineSize: number | null;
  pointsToWin: number | null;
  turnTimeLimitSeconds: number | null;
  players: RoomPlayerState[];
  timeline: ApiTimelineEntry[];
  scores: Record<string, number>;
  turnOrder: string[];
  currentTurnPlayerId: string | null;
  currentTurnStartedAt: string | null;
  /** Requesting player's hand (up to 3 cards). Only populated when forPlayerId is passed to getRoomState. */
  myHand: ApiEvent[];
  nextDeckSequence: number;
  initialEventId: string | null;
  endedAt: string | null;
  winnerPlayerId: string | null;
};

/** API: place response (single player score = current player's score) */
export type PlaceResult = {
  correct: boolean;
  gameEnded?: boolean;
  correctPosition?: number;
  score: number;
  timeline: ApiTimelineEntry[];
  nextEvent?: ApiEvent | null;
  nextTurnPlayerId?: string | null;
};
