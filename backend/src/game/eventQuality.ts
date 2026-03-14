/**
 * Event quality filter. Used when building deck to prefer good timeline events.
 * Moved from frontend eventQualityFilter; backend is source of truth.
 */

export type EventLike = {
  title?: string | null;
  year?: number;
  image?: string | null;
  wikipediaUrl?: string | null;
  wikipedia_url?: string | null;
};

const RANGE_REGEX = /\d{4}[-–]\d{2}/;
const YEAR_IN_TITLE_REGEX = /\b(1[0-9]{3}|20[0-9]{2})\b/;

export function isGoodEvent(event: EventLike): boolean {
  const title = event.title?.trim();
  if (!title) return false;
  if (title.length < 5 || title.length > 120) return false;

  const year = event.year;
  if (typeof year !== "number" || Number.isNaN(year)) return false;

  const currentYear = new Date().getUTCFullYear();
  if (year > currentYear) return false;

  const wikipediaUrl = event.wikipediaUrl ?? event.wikipedia_url;
  if (!wikipediaUrl) return false;
  if (!event.image) return false;

  if (RANGE_REGEX.test(title)) return false;
  if (YEAR_IN_TITLE_REGEX.test(title)) return false;

  return true;
}

/** Filter events to those passing quality check. If none pass, returns all (fallback). */
export function filterGoodEvents<T extends EventLike>(events: T[]): T[] {
  const good = events.filter((e) => isGoodEvent(e));
  return good.length > 0 ? good : events;
}
