/**
 * Per-room snapshot of EventRecords for the current match. Populated in startGame from the
 * selected deck; timeline/hands/draw resolve here first so play avoids round-trips to `events`.
 */
import type { EventRecord } from "../types.js";

const byRoom = new Map<string, Map<string, EventRecord>>();

export function primeRoomGameEvents(roomId: string, events: readonly EventRecord[]): void {
  const m = new Map<string, EventRecord>();
  for (const e of events) {
    m.set(e.id, e);
  }
  byRoom.set(roomId, m);
}

export function clearRoomGameEvents(roomId: string): void {
  byRoom.delete(roomId);
}

export function getRoomGameEvent(roomId: string, eventId: string): EventRecord | undefined {
  return byRoom.get(roomId)?.get(eventId);
}
