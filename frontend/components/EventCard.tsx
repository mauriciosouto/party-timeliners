"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { TimelineEvent } from "@/lib/types";
import { getWikimediaThumbnail } from "@/lib/imageUtils";
import { formatYear } from "@/lib/format";
import { getEventType, getTypeStyle } from "@/lib/eventTypeStyles";

type EventCardProps = {
  event: TimelineEvent;
  label?: string;
  showYear?: boolean;
  /** When true, card flips to reveal year (timeline placed card). */
  revealed?: boolean;
  /** When true, event title links to Wikipedia (timeline placed events only). */
  titleLinksToWikipedia?: boolean;
  /** Trigger one-time flip animation after place (timeline card). */
  animateReveal?: boolean;
  className?: string;
  draggable?: boolean;
  draggableId?: string;
  /** Optional ref callback for scroll-into-view after place */
  cardRef?: (el: HTMLDivElement | null) => void;
};

export function EventCard({
  event,
  label,
  showYear = true,
  revealed = true,
  titleLinksToWikipedia = false,
  animateReveal = false,
  className,
  draggable,
  draggableId,
  cardRef,
}: EventCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: draggableId ?? event.id,
    });

  const [flipped, setFlipped] = useState(false);
  const [imageError, setImageError] = useState(false);
  const typeLabel = getEventType(event.description);
  const styleMap = getTypeStyle(typeLabel);

  useEffect(() => {
    queueMicrotask(() => setImageError(false));
  }, [event.id, event.image]);

  useEffect(() => {
    if (!animateReveal) return;
    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlipped(true));
    });
    return () => cancelAnimationFrame(t);
  }, [animateReveal]);

  const style: CSSProperties | undefined =
    draggable && transform
      ? {
          transform: CSS.Translate.toString(transform) + (isDragging ? " scale(1.04) rotate(1deg)" : ""),
          boxShadow: isDragging
            ? undefined
            : "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)",
          zIndex: isDragging ? 50 : 1,
          transition: isDragging ? "none" : "box-shadow 0.2s ease, transform 0.15s ease",
        }
      : undefined;

  const showYearValue = showYear && (revealed || flipped);

  return (
    <div
      ref={(el) => {
        if (typeof cardRef === "function") cardRef(el);
        if (draggable) setNodeRef(el);
      }}
      style={style}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={`
        event-card
        relative min-w-[160px] max-w-[200px] rounded-[14px]
        shadow-[0_4px_12px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.06)]
        transition-all duration-200 ease
        hover:shadow-[0_14px_30px_rgba(0,0,0,0.18)]
        border-l-4 ${styleMap.border}
        ${className ?? ""}
        ${isDragging ? "dragging cursor-grabbing will-change-[transform]" : draggable ? "cursor-grab" : ""}
        ${animateReveal ? "card-settle" : ""}
      `}
    >
      <div className="relative flex h-full min-h-[120px] flex-col rounded-[14px] bg-gradient-to-b from-white to-neutral-100 p-4 overflow-hidden">
        {event.image && (
          <div className="flex h-[120px] shrink-0 w-full items-center justify-center overflow-hidden rounded-t-[12px] -mt-4 -mx-4 mb-2 bg-zinc-100/50">
            {!imageError ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Wikimedia URL, no next/image config
              <img
                src={getWikimediaThumbnail(event.image)}
                alt=""
                className="event-image"
                loading="lazy"
                onError={() => setImageError(true)}
              />
            ) : (
              <div
                className="flex h-full min-h-[120px] w-full items-center justify-center rounded-t-[12px] bg-zinc-200/80 text-[10px] font-medium text-zinc-500"
                aria-hidden
              >
                No Image
              </div>
            )}
          </div>
        )}
        {label && (
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            {label}
          </div>
        )}
        <h3 className="text-sm font-bold leading-snug text-zinc-900 line-clamp-2">
          {event.wikipediaUrl && titleLinksToWikipedia ? (
            <a
              href={event.wikipediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-700 underline decoration-violet-300 underline-offset-1 hover:text-violet-900 hover:decoration-violet-500"
            >
              {event.title}
            </a>
          ) : (
            event.title
          )}
        </h3>
        <p className={`mt-1.5 text-xs font-medium ${styleMap.text}`}>
          ({typeLabel})
        </p>
        <div className="mt-2 min-h-[20px]">
          {showYearValue ? (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold transition-opacity duration-300 ${styleMap.bg} ${styleMap.text}`}
            >
              {formatYear(event.year)}
            </span>
          ) : (
            <span className="inline-flex h-6 items-center rounded-full bg-zinc-200/80 px-2 text-[10px] font-medium text-zinc-500">
              ?
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
