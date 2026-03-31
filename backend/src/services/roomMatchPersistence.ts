import { randomUUID } from "node:crypto";
import type { RoomState } from "../types.js";
import { exec } from "../db/index.js";

export type RoomMatchPersistReason =
  | "game_finished"
  | "host_aborted"
  | "room_closed"
  | "players_left_abort";

export function schedulePersistRoomMatch(reason: RoomMatchPersistReason, state: RoomState): void {
  void persistRoomMatch(reason, state).catch((e) =>
    console.warn("[roomMatchPersistence] insert failed:", e),
  );
}

async function persistRoomMatch(reason: RoomMatchPersistReason, state: RoomState): Promise<void> {
  const id = randomUUID();
  const endedAt = state.endedAt ?? new Date().toISOString();
  await exec(
    `INSERT INTO room_match_metrics (id, room_id, reason, ended_at, winner_player_id, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, state.roomId, reason, endedAt, state.winnerPlayerId, state],
  );
}
