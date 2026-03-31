/**
 * Streak milestone copy (UX only). Backend/tests use this module.
 * Frontend duplicates the same helpers in `frontend/lib/streakMilestones.ts` because
 * Next.js Turbopack does not bundle files outside the `frontend/` app directory.
 *
 * Badge: streak 0–1 → no label; 2 → "Nice!"; 3 → "On Fire"; 4+ → "Unstoppable"
 * Callout: same labels; streak 2+, with "!" on 3 and 4+ per product spec.
 */

/** Short label for compact scoreboard (no "!" — paired with 🔥 xN in UI). */
export function getStreakBadgeLabel(streak: number): string | null {
  if (streak < 2) return null;
  if (streak === 2) return "Nice!";
  if (streak === 3) return "On Fire";
  return "Unstoppable";
}

/**
 * Brief celebratory line after a correct placement that hits a milestone.
 * Returns null when no milestone (below 2).
 */
export function getStreakMilestoneCallout(streak: number): string | null {
  if (streak < 2) return null;
  if (streak === 2) return "Nice!";
  if (streak === 3) return "On Fire!";
  return "Unstoppable!";
}
