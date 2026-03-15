import confetti from "canvas-confetti";

/**
 * Fires a dramatic multi-burst victory confetti effect (~3 seconds).
 * Use when the game ends and a winner is determined.
 */
export function fireVictoryConfetti(): void {
  const duration = 3000;
  const end = Date.now() + duration;

  const colors = ["#6366f1", "#8b5cf6", "#22c55e", "#facc15"];

  (function frame() {
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors,
    });

    confetti({
      particleCount: 5,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
}
