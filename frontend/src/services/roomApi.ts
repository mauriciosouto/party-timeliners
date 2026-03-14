import { getApiUrl } from "@/lib/api";

export type RoomPlayerState = {
  playerId: string;
  nickname: string;
  isHost: boolean;
  score: number;
  turnOrder: number | null;
  connected: boolean;
  joinedAt: string;
};

export type ApiEvent = {
  id: string;
  title: string;
  year: number;
  displayTitle: string;
  image?: string;
  wikipediaUrl?: string;
};

export type TimelineEntryState = {
  event: ApiEvent;
  position: number;
  placedByPlayerId?: string | null;
  placedAt?: string;
};

export type RoomState = {
  roomId: string;
  name: string;
  status: "lobby" | "playing" | "ended";
  hostPlayerId: string | null;
  maxTimelineSize: number | null;
  pointsToWin: number | null;
  turnTimeLimitSeconds: number | null;
  players: RoomPlayerState[];
  timeline: TimelineEntryState[];
  scores: Record<string, number>;
  turnOrder: string[];
  currentTurnPlayerId: string | null;
  currentTurnStartedAt: string | null;
  nextDeckSequence: number;
  initialEventId: string | null;
  endedAt: string | null;
  winnerPlayerId: string | null;
};

export type CreateRoomOptions = {
  maxTimelineSize?: number;
  pointsToWin?: number;
  turnTimeLimitSeconds?: number | null;
};

export async function createRoom(
  nickname: string,
  roomName?: string,
  options?: CreateRoomOptions,
): Promise<{ roomId: string; playerId: string; roomState: RoomState }> {
  const body: Record<string, unknown> = {
    nickname: nickname.trim() || "Player",
    name: roomName?.trim(),
  };
  if (options?.maxTimelineSize != null) body.maxTimelineSize = options.maxTimelineSize;
  if (options?.pointsToWin != null) body.pointsToWin = options.pointsToWin;
  if (options?.turnTimeLimitSeconds !== undefined) body.turnTimeLimitSeconds = options.turnTimeLimitSeconds;
  const res = await fetch(`${getApiUrl()}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create room");
  return res.json();
}

export async function joinRoom(
  roomId: string,
  nickname: string,
  email?: string,
): Promise<{ playerId: string; roomState: RoomState }> {
  const res = await fetch(`${getApiUrl()}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: nickname.trim() || "Player",
      email: email?.trim() || undefined,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to join room");
  }
  return res.json();
}

export async function getRoomState(roomId: string): Promise<RoomState | null> {
  const res = await fetch(`${getApiUrl()}/api/rooms/${roomId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load room");
  return res.json();
}

export async function startGame(
  roomId: string,
  playerId: string,
): Promise<RoomState> {
  const res = await fetch(`${getApiUrl()}/api/rooms/${roomId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to start game");
  }
  return res.json();
}

export async function getNextEvent(
  roomId: string,
  playerId: string,
): Promise<ApiEvent | null> {
  const res = await fetch(
    `${getApiUrl()}/api/rooms/${roomId}/next-event?playerId=${encodeURIComponent(playerId)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to get next event");
  const data = await res.json();
  return data.event ?? null;
}

export async function turnTimeout(
  roomId: string,
  playerId: string,
): Promise<{
  nextTurnPlayerId: string | null;
  nextEvent: ApiEvent | null;
  gameEnded?: boolean;
}> {
  const res = await fetch(`${getApiUrl()}/api/rooms/${roomId}/turn-timeout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to timeout turn");
  }
  return res.json();
}
