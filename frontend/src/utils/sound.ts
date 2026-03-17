const sounds = {
  correct: typeof Audio !== "undefined" ? new Audio("/sounds/correct.mp3") : null,
  wrong: typeof Audio !== "undefined" ? new Audio("/sounds/wrong.mp3") : null,
  victory: typeof Audio !== "undefined" ? new Audio("/sounds/victory.mp3") : null,
  defeat: typeof Audio !== "undefined" ? new Audio("/sounds/defeat.mp3") : null,
  tick: typeof Audio !== "undefined" ? new Audio("/sounds/tick.mp3") : null,
};

let tickStopTimeoutId: ReturnType<typeof setTimeout> | null = null;

const TICK_MAX_DURATION_MS = 3000;

export function playSound(type: "correct" | "wrong" | "victory" | "defeat" | "tick"): void {
  const sound = sounds[type];
  if (!sound) return;

  sound.currentTime = 0;
  try {
    sound.play().catch((err) => {
      console.warn("Audio playback blocked or failed", err);
    });
  } catch (err) {
    console.warn("Audio playback failed", err);
  }

  if (type === "tick") {
    if (tickStopTimeoutId != null) clearTimeout(tickStopTimeoutId);
    tickStopTimeoutId = setTimeout(() => {
      sound.pause();
      sound.currentTime = 0;
      tickStopTimeoutId = null;
    }, TICK_MAX_DURATION_MS);
  }
}

/** Detiene el sonido tick de inmediato (p. ej. cuando termina el tiempo de turno). */
export function stopTickSound(): void {
  if (tickStopTimeoutId != null) {
    clearTimeout(tickStopTimeoutId);
    tickStopTimeoutId = null;
  }
  const tick = sounds.tick;
  if (tick) {
    tick.pause();
    tick.currentTime = 0;
  }
}

const joinSound =
  typeof Audio !== "undefined" ? new Audio("/sounds/player_join.mp3") : null;
const JOIN_VOLUME = 0.35;

/** Sonido corto cuando un nuevo jugador entra al lobby. Una vez por join, sin loop. */
export function playJoinSound(): void {
  if (!joinSound) return;
  joinSound.volume = JOIN_VOLUME;
  joinSound.currentTime = 0;
  try {
    joinSound.play().catch((err) => console.warn("Audio playback blocked or failed", err));
  } catch (err) {
    console.warn("Audio playback failed", err);
  }
}

const startSound =
  typeof Audio !== "undefined" ? new Audio("/sounds/game_start.mp3") : null;
const START_VOLUME = 0.4;

/** Sonido cuando la partida pasa de lobby a juego activo. Corto, sin loop. */
export function playStartGameSound(): void {
  if (!startSound) return;
  startSound.volume = START_VOLUME;
  startSound.currentTime = 0;
  try {
    startSound.play().catch((err) => console.warn("Audio playback blocked or failed", err));
  } catch (err) {
    console.warn("Audio playback failed", err);
  }
}

const yourTurnSound =
  typeof Audio !== "undefined" ? new Audio("/sounds/your_turn.mp3") : null;
const YOUR_TURN_VOLUME = 0.4;

/** Short, non-intrusive sound when it becomes the local player's turn. Fails gracefully if autoplay is blocked or file is missing. */
export function playYourTurnSound(): void {
  if (!yourTurnSound) return;
  yourTurnSound.volume = YOUR_TURN_VOLUME;
  yourTurnSound.currentTime = 0;
  try {
    yourTurnSound.play().catch(() => {
      /* Autoplay blocked or file missing — fail silently */
    });
  } catch {
    /* Fail gracefully */
  }
}
