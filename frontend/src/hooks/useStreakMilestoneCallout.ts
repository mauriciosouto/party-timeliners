"use client";

import { useEffect, useState } from "react";
import { getStreakMilestoneCallout } from "@/lib/streakMilestones";

export type PlaceResultLike = {
  correct: boolean;
  streak?: number;
} | null;

/**
 * Short-lived milestone message after a correct placement (streak 2+).
 * Independent timer from the main place-result toast.
 */
export function useStreakMilestoneCallout(placeResult: PlaceResultLike): string | null {
  const [message, setMessage] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- timed toast driven by WS place_result */
  useEffect(() => {
    if (!placeResult?.correct || placeResult.streak === undefined) {
      setMessage(null);
      return;
    }
    const msg = getStreakMilestoneCallout(placeResult.streak);
    if (!msg) {
      setMessage(null);
      return;
    }
    setMessage(msg);
    const t = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(t);
  }, [placeResult?.correct, placeResult?.streak]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return message;
}
