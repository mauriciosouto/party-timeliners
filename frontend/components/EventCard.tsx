import type { TimelineEvent } from "@/lib/types";
import { formatYear } from "@/lib/format";

type EventCardProps = {
  event: TimelineEvent;
  /**
   * Optional small label shown above the year,
   * e.g. "Timeline" or "Place this event".
   */
  label?: string;
  /**
   * Whether to show the year pill. Defaults to true.
   */
  showYear?: boolean;
  className?: string;
};

export function EventCard({
  event,
  label,
  showYear = true,
  className,
}: EventCardProps) {
  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3 text-left shadow-sm backdrop-blur-sm ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        {showYear ? (
          <div className="inline-flex items-center rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pink-600">
            {formatYear(event.year)}
          </div>
        ) : (
          <span />
        )}
        {label && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {label}
          </span>
        )}
      </div>
      <div className="mt-2 text-sm font-semibold text-zinc-900">
        {event.title}
      </div>
      <p className="mt-1 text-xs text-zinc-600">{event.description}</p>
    </div>
  );
}

