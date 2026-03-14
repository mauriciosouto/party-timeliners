/**
 * Timeline position validation. Pure logic; no DB.
 */

/**
 * Valid position to insert a new event: 0 to timelineLength (inclusive).
 * position 0 = before first, position N = after last (N = current length).
 */
export function isValidPosition(position: number, timelineLength: number): boolean {
  return (
    typeof position === "number" &&
    Number.isInteger(position) &&
    position >= 0 &&
    position <= timelineLength
  );
}

/**
 * Given sorted timeline years and a new event year, find the correct insert index
 * so that timeline stays chronologically ordered.
 */
export function findCorrectPosition(
  timelineYears: number[],
  eventYear: number,
): number {
  const idx = timelineYears.findIndex((y) => y > eventYear);
  return idx === -1 ? timelineYears.length : idx;
}

/**
 * Check if placing event at position is chronologically correct.
 */
export function isCorrectPlacement(
  timelineYears: number[],
  position: number,
  eventYear: number,
): boolean {
  const prevYear = position > 0 ? timelineYears[position - 1] : -Infinity;
  const nextYear =
    position < timelineYears.length ? timelineYears[position] : Infinity;
  return eventYear >= prevYear && eventYear <= nextYear;
}
