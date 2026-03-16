/**
 * Centralized avatar list. Assets live under /public/avatars/.
 * Used for player profile selection before creating or joining a room.
 */
export const AVAILABLE_AVATARS = [
  "/avatars/character-1.png",
  "/avatars/character-2.png",
  "/avatars/character-3.png",
  "/avatars/character-4.png",
  "/avatars/character-5.png",
  "/avatars/character-6.png",
  "/avatars/character-7.png",
  "/avatars/character-8.png",
  "/avatars/character-9.png",
  "/avatars/character-10.png",
  "/avatars/character-11.png",
  "/avatars/character-12.png",
  "/avatars/character-13.png",
  "/avatars/character-14.png",
  "/avatars/character-15.png",
  "/avatars/character-16.png",
  "/avatars/character-17.png",
  "/avatars/character-18.png",
] as const;

export type AvatarPath = (typeof AVAILABLE_AVATARS)[number];

/** Returns a random avatar path. Use when the user does not select one. */
export function getRandomAvatar(): string {
  const i = Math.floor(Math.random() * AVAILABLE_AVATARS.length);
  return AVAILABLE_AVATARS[i] ?? AVAILABLE_AVATARS[0]!;
}
