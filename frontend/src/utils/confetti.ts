import confetti from "canvas-confetti";

/**
 * Fires a success confetti burst, originating near the timeline area.
 * Use for correct card placement feedback.
 */
export function fireSuccessConfetti(): void {
  confetti({
    particleCount: 80,
    spread: 80,
    origin: { x: 0.5, y: 0.6 },
  });
}
