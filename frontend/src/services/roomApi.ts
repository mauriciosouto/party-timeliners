import { getApiUrl } from "@/lib/api";
import type {
  GameState,
  ApiEvent,
  TimelineEntry,
  RoomPlayer,
} from "shared/types";

/** Canonical game state types (shared with backend). */
export type { GameState, ApiEvent, TimelineEntry, RoomPlayer };
export type RoomState = GameState;
export type RoomPlayerState = RoomPlayer;
export type TimelineEntryState = TimelineEntry;

export type CreateRoomOptions = {
  maxTimelineSize?: number;
  pointsToWin?: number;
  turnTimeLimitSeconds?: number | null;
  avatar?: string | null;
};

async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    console.warn("API request failed:", url, err);
    throw err;
  }
}

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
  if (options?.avatar != null) body.avatar = options.avatar;
  const res = await safeFetch(`${getApiUrl()}/api/rooms`, {
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
  avatar?: string | null,
): Promise<{ playerId: string; roomState: RoomState }> {
  const body: Record<string, unknown> = { nickname: nickname.trim() || "Player" };
  if (avatar) body.avatar = avatar;
  const res = await safeFetch(`${getApiUrl()}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to join room");
  }
  return res.json();
}

export async function getRoomState(roomId: string): Promise<RoomState | null> {
  const res = await safeFetch(`${getApiUrl()}/api/rooms/${roomId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load room");
  return res.json();
}

export async function startGame(
  roomId: string,
  playerId: string,
): Promise<RoomState> {
  const res = await safeFetch(`${getApiUrl()}/api/rooms/${roomId}/start`, {
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
  const res = await safeFetch(
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
  const res = await safeFetch(`${getApiUrl()}/api/rooms/${roomId}/turn-timeout`, {
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
