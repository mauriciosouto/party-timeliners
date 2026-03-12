"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
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
  /**
   * If true, the card becomes a dnd-kit draggable source.
   */
  draggable?: boolean;
  /**
   * Optional id to use for the draggable item. Defaults to event.id.
   */
  draggableId?: string;
};

export function EventCard({
  event,
  label,
  showYear = true,
  className,
}: EventCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: event.id,
    });

  const style: CSSProperties | undefined = transform
    ? {
        transform: CSS.Translate.toString(transform),
        boxShadow: isDragging
          ? "0 20px 40px rgba(0,0,0,0.18)"
          : "0 10px 25px rgba(0,0,0,0.08)",
        scale: isDragging ? 1.02 : 1,
        zIndex: isDragging ? 50 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
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

