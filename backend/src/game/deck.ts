/**
 * Deck generation: shuffle and pick events. Used when starting a game.
 * Logic moved from frontend roomEventDeck; backend owns the deck.
 */

import type { EventLike } from "./eventQuality.js";
import { filterGoodEvents } from "./eventQuality.js";

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Build a deck: prefer quality events, shuffle, take up to `size`.
 * Excludes any event IDs in excludeIds (e.g. already on timeline).
 */
export function buildDeck<T extends EventLike & { id: string }>(
  pool: T[],
  size: number,
  excludeIds: Set<string> = new Set(),
): T[] {
  const available = pool.filter((e) => !excludeIds.has(e.id));
  const preferred = filterGoodEvents(available);
  const source = preferred.length > 0 ? preferred : available;
  const shuffled = shuffle(source);
  return shuffled.slice(0, size);
}
