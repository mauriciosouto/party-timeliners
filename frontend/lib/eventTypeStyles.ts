/**
 * Color accents by event type for timeline cards.
 * Type is parsed from description (e.g. "Star Wars (Film)" → "Film").
 */
const TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  Film: { border: "border-l-violet-500", bg: "bg-violet-50", text: "text-violet-700" },
  Book: { border: "border-l-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  "Video game": { border: "border-l-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  "Music album": { border: "border-l-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  Song: { border: "border-l-amber-600", bg: "bg-amber-50", text: "text-amber-800" },
  "TV series": { border: "border-l-fuchsia-500", bg: "bg-fuchsia-50", text: "text-fuchsia-700" },
  Invention: { border: "border-l-sky-500", bg: "bg-sky-50", text: "text-sky-700" },
  "Scientific discovery": { border: "border-l-teal-500", bg: "bg-teal-50", text: "text-teal-700" },
  "Medical discovery": { border: "border-l-cyan-500", bg: "bg-cyan-50", text: "text-cyan-700" },
  "Space mission": { border: "border-l-orange-500", bg: "bg-orange-50", text: "text-orange-700" },
  Software: { border: "border-l-indigo-500", bg: "bg-indigo-50", text: "text-indigo-700" },
  "Consumer product": { border: "border-l-lime-600", bg: "bg-lime-50", text: "text-lime-800" },
  Award: { border: "border-l-yellow-600", bg: "bg-yellow-50", text: "text-yellow-800" },
  Festival: { border: "border-l-rose-500", bg: "bg-rose-50", text: "text-rose-700" },
  "Celebrity birth": { border: "border-l-pink-500", bg: "bg-pink-50", text: "text-pink-700" },
};

const DEFAULT_STYLE = { border: "border-l-zinc-400", bg: "bg-zinc-50", text: "text-zinc-700" };

/** Extract type from description like "Star Wars (Film)" → "Film" */
export function getEventType(description: string | undefined): string {
  if (!description) return "Event";
  const match = /\(([^)]+)\)\s*$/.exec(description);
  return match ? match[1].trim() : "Event";
}

export function getTypeStyle(type: string) {
  return TYPE_COLORS[type] ?? DEFAULT_STYLE;
}
