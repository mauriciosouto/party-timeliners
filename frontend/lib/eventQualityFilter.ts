import type { Event } from "@/lib/eventPool";

const RANGE_REGEX = /\d{4}[-–]\d{2}/;
const YEAR_IN_TITLE_REGEX = /\b(1[0-9]{3}|20[0-9]{2})\b/;

export function isGoodEvent(event: Event): boolean {
  const title = event.title?.trim();
  if (!title) return false;
  if (title.length < 5 || title.length > 120) return false;

  const year = event.year;
  if (typeof year !== "number" || Number.isNaN(year)) return false;

  const currentYear = new Date().getFullYear();
  if (year > currentYear) return false;

  if (!event.wikipediaUrl) return false;

  if (!event.image) return false;

  // Filtra títulos que parecen rangos tipo "1990–91"
  if (RANGE_REGEX.test(title)) return false;

  // Filtra títulos que contienen un año explícito, p.ej. "Battle of X (1815)" o "World Cup 1998"
  if (YEAR_IN_TITLE_REGEX.test(title)) return false;

  return true;
}

