const STORAGE_KEY = (roomId: string) => `room_${roomId}`;
const LAST_ROOM_KEY = "lastRoom";

export type StoredPlayer = { playerId: string; nickname: string };
export type LastRoom = { roomId: string; playerId: string; nickname: string };

function isClient(): boolean {
  return typeof window !== "undefined";
}

export function getStoredPlayer(roomId: string): StoredPlayer | null {
  if (!isClient()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY(roomId));
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredPlayer;
    return data?.playerId && data?.nickname ? data : null;
  } catch {
    return null;
  }
}

/** Saves credentials for this room and sets this room as the "last room" for the home page. */
export function setStoredPlayer(
  roomId: string,
  playerId: string,
  nickname: string,
): void {
  if (!isClient()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY(roomId),
      JSON.stringify({ playerId, nickname }),
    );
    localStorage.setItem(
      LAST_ROOM_KEY,
      JSON.stringify({ roomId, playerId, nickname }),
    );
  } catch {
    // ignore
  }
}

export function getLastRoom(): LastRoom | null {
  if (!isClient()) return null;
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LastRoom;
    return data?.roomId && data?.playerId && data?.nickname ? data : null;
  } catch {
    return null;
  }
}

/** Removes stored credentials for a room and clears lastRoom if it referred to this room. */
export function clearRoomFromStorage(roomId: string): void {
  if (!isClient()) return;
  try {
    localStorage.removeItem(STORAGE_KEY(roomId));
    const last = getLastRoom();
    if (last?.roomId === roomId) {
      localStorage.removeItem(LAST_ROOM_KEY);
    }
  } catch {
    // ignore
  }
}
