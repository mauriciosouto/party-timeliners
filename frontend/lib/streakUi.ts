import { getStreakBadgeLabel } from "@/lib/streakMilestones";

/** Compact scoreboard text when streak ≥ 2; null when hidden. */
export function formatStreakScoreboardBadge(streak: number): string | null {
  if (streak < 2) return null;
  const label = getStreakBadgeLabel(streak);
  if (streak === 2) return "🔥 x2";
  return label ? `🔥 x${streak} ${label}` : `🔥 x${streak}`;
}
