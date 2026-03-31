/**
 * Game module: canonical game logic.
 * - Event quality filtering (for deck building)
 * - Deck generation (shuffle, build deck with quality preference)
 * - Timeline validation (position, correct placement)
 * - Move validation (turn, event, position)
 *
 * Room runtime uses this module; gameplay state is held in memory (liveRoomStore).
 */

export { isGoodEvent, filterGoodEvents } from "./eventQuality.js";
export type { EventLike } from "./eventQuality.js";
export { shuffle, buildDeck } from "./deck.js";
export {
  isValidPosition,
  findCorrectPosition,
  isCorrectPlacement,
} from "./timeline.js";
export {
  validatePlace,
  getNextTurnPlayerId,
} from "./validation.js";
export type { ValidatePlaceContext, ValidatePlaceResult } from "./validation.js";
