"use client";

import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import type { TimelineEvent } from "@/lib/types";
import { EventCard } from "@/components/EventCard";

export const SLOT_ID_PREFIX = "slot-";

export function makeSlotId(index: number): string {
  return `${SLOT_ID_PREFIX}${index}`;
}

export function parseSlotIndexFromId(
  id: string | null | undefined,
): number | null {
  if (!id || !id.startsWith(SLOT_ID_PREFIX)) return null;
  const raw = id.slice(SLOT_ID_PREFIX.length);
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return null;
  return value;
}

type TimelineSlotProps = {
  index: number;
};

function TimelineSlot({ index }: TimelineSlotProps) {
  const droppableId = makeSlotId(index);
  const { isOver, setNodeRef } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className={`
        flex min-h-[48px] min-w-[40px] flex-shrink-0 flex-col items-center justify-center
        rounded-[10px] border-2 border-dashed bg-[#f8fafc]
        transition-all duration-200 ease
        touch-manipulation
        ${
          isOver
            ? "border-violet-500 bg-[#eef2ff] scale-105 shadow-md"
            : "border-[#cbd5f5] hover:border-[#6366f1] hover:bg-[#eef2ff]"
        }
      `}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
        drop
      </span>
    </div>
  );
}

export type TimelineProps = {
  events: TimelineEvent[];
  /** Id of the event that was just placed (triggers flip + scroll) */
  lastPlacedId?: string | null;
  /** Ref callback for the card that was just placed (for scrollIntoView) */
  onPlacedCardRef?: (el: HTMLDivElement | null) => void;
};

export function Timeline({
  events,
  lastPlacedId,
  onPlacedCardRef,
}: TimelineProps) {
  const slots = useMemo(
    () => Array.from({ length: events.length + 1 }, (_, i) => i),
    [events.length],
  );

  return (
    <div
      className="relative flex gap-4 overflow-x-auto overflow-y-visible px-5 py-6 scroll-smooth pb-8 before:absolute before:left-5 before:right-5 before:top-1/2 before:h-1 before:-translate-y-1/2 before:rounded-sm before:bg-[#e2e8f0] before:content-['']"
      style={{
        WebkitOverflowScrolling: "touch",
        scrollbarGutter: "stable",
      }}
      role="list"
      aria-label="Timeline events"
    >
      {slots.map((slotIndex) => (
        <div key={slotIndex} className="relative z-10 flex flex-shrink-0 items-center gap-3">
          {slotIndex > 0 ? (
            <EventCard
              event={events[slotIndex - 1]}
              showYear
              revealed={events[slotIndex - 1].id !== lastPlacedId}
              titleLinksToWikipedia
              animateReveal={events[slotIndex - 1].id === lastPlacedId}
              cardRef={
                events[slotIndex - 1].id === lastPlacedId
                  ? onPlacedCardRef
                  : undefined
              }
              className="flex-shrink-0"
            />
          ) : null}
          <TimelineSlot index={slotIndex} />
        </div>
      ))}
    </div>
  );
}
