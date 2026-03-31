/**
 * Streak milestone copy (UX). Must stay in sync with `shared/streak.ts` (Next.js Turbopack
 * cannot resolve imports outside `frontend/` for client bundles).
 */

export function getStreakBadgeLabel(streak: number): string | null {
  if (streak < 2) return null;
  if (streak === 2) return "Nice!";
  if (streak === 3) return "On Fire";
  return "Unstoppable";
}

export function getStreakMilestoneCallout(streak: number): string | null {
  if (streak < 2) return null;
  if (streak === 2) return "Nice!";
  if (streak === 3) return "On Fire!";
  return "Unstoppable!";
}
