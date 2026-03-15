const sounds = {
  correct: typeof Audio !== "undefined" ? new Audio("/sounds/correct.mp3") : null,
  wrong: typeof Audio !== "undefined" ? new Audio("/sounds/wrong.mp3") : null,
  victory: typeof Audio !== "undefined" ? new Audio("/sounds/victory.mp3") : null,
  defeat: typeof Audio !== "undefined" ? new Audio("/sounds/defeat.mp3") : null,
};

export function playSound(type: "correct" | "wrong" | "victory" | "defeat"): void {
  const sound = sounds[type];
  if (!sound) return;

  sound.currentTime = 0;
  sound.play().catch(() => {});
}
