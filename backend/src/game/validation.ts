/**
 * Move validation: turn check, event-in-deck check, position check.
 * Pure logic used by roomService before applying DB updates.
 */

import type { EventLike } from "./eventQuality.js";
import { isValidPosition, isCorrectPlacement } from "./timeline.js";

export type ValidatePlaceContext = {
  currentTurnPlayerId: string | null;
  turnOrder: string[];
  turnIndex: number;
  /** Event IDs in the current player's hand (player may place any one). */
  handEventIds: Set<string>;
  timelineYears: number[];
  timelineLength: number;
  maxTimelineSize: number;
  pointsToWin: number;
  currentPlayerScore: number;
};

export type ValidatePlaceResult =
  | { valid: true; correct: boolean; correctPosition: number }
  | { valid: false; error: string };

/**
 * Validate a place move. Returns either valid (with correct/correctPosition) or error.
 */
export function validatePlace(
  playerId: string,
  eventId: string,
  position: number,
  event: EventLike & { year: number },
  ctx: ValidatePlaceContext,
): ValidatePlaceResult {
  if (ctx.currentTurnPlayerId !== playerId) {
    return { valid: false, error: "Not your turn" };
  }
  if (!ctx.handEventIds.has(eventId)) {
    return { valid: false, error: "Event not in your hand" };
  }
  if (!isValidPosition(position, ctx.timelineLength)) {
    return { valid: false, error: "Invalid position" };
  }

  const correct = isCorrectPlacement(ctx.timelineYears, position, event.year);
  const correctPosition = correct
    ? position
    : ctx.timelineYears.findIndex((y) => y > event.year) === -1
      ? ctx.timelineYears.length
      : ctx.timelineYears.findIndex((y) => y > event.year);

  return { valid: true, correct, correctPosition };
}

export function getNextTurnPlayerId(
  turnOrder: string[],
  turnIndex: number,
): string | null {
  if (turnOrder.length === 0) return null;
  const nextIndex = (turnIndex + 1) % turnOrder.length;
  return turnOrder[nextIndex] ?? null;
}
