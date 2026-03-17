"use client";

import { useDroppable } from "@dnd-kit/core";
import { useLayoutEffect, useMemo, useRef } from "react";
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
      className={`timeline-slot flex flex-shrink-0 flex-col items-center justify-center touch-manipulation ${
        isOver ? "timeline-slot-highlight !border-violet-500 !bg-[#eef2ff]/80 scale-105 shadow-md" : ""
      }`}
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
  /** Event id to highlight in the timeline (e.g. last placed from server); subtle temporary highlight */
  highlightEventId?: string | null;
  /** Ref callback for the card that was just placed (for scrollIntoView) */
  onPlacedCardRef?: (el: HTMLDivElement | null) => void;
  /** When true, timeline shows drag-active glow (set by parent when inside DndContext) */
  dragActive?: boolean;
};

const FLIP_TRANSITION = "transform 0.35s ease-out";

export function Timeline({
  events,
  lastPlacedId,
  highlightEventId,
  onPlacedCardRef,
  dragActive = false,
}: TimelineProps) {
  const slots = useMemo(
    () => Array.from({ length: events.length + 1 }, (_, i) => i),
    [events.length],
  );
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const prevRects = useRef<Map<number, DOMRect>>(new Map());
  const prevSlotsLength = useRef<number | null>(null);

  useLayoutEffect(() => {
    const newRects = new Map<number, DOMRect>();
    itemRefs.current.forEach((el, slotIndex) => {
      if (el) newRects.set(slotIndex, el.getBoundingClientRect());
    });
    const oldRects = prevRects.current;
    const contentChanged = prevSlotsLength.current !== null && prevSlotsLength.current !== slots.length;
    prevRects.current = newRects;
    prevSlotsLength.current = slots.length;

    if (contentChanged && oldRects.size > 0) {
      const toAnimate: { el: HTMLDivElement; deltaX: number; deltaY: number }[] = [];
      newRects.forEach((newRect, slotIndex) => {
        const oldRect = oldRects.get(slotIndex);
        const el = itemRefs.current.get(slotIndex);
        if (el && oldRect && (oldRect.left !== newRect.left || oldRect.top !== newRect.top)) {
          toAnimate.push({
            el,
            deltaX: oldRect.left - newRect.left,
            deltaY: oldRect.top - newRect.top,
          });
        }
      });
      toAnimate.forEach(({ el, deltaX, deltaY }) => {
        el.style.transition = "none";
        el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      });
      const raf = requestAnimationFrame(() => {
        toAnimate.forEach(({ el }) => {
          el.style.transition = FLIP_TRANSITION;
          el.style.transform = "";
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [events, slots.length]);

  return (
    <div
      className={`timeline relative flex gap-4 overflow-x-auto overflow-y-visible px-5 py-6 scroll-smooth pb-8 before:absolute before:left-5 before:right-5 before:top-1/2 before:h-1 before:-translate-y-1/2 before:rounded-sm before:bg-[#e2e8f0] before:content-[''] ${dragActive ? "drag-active" : ""}`}
      style={{
        WebkitOverflowScrolling: "touch",
        scrollbarGutter: "stable",
        overscrollBehaviorX: "contain",
        overscrollBehaviorY: "auto",
      }}
      role="list"
      aria-label="Timeline events"
    >
      {slots.map((slotIndex) => (
        <div
          key={slotIndex}
          ref={(el) => {
            if (el) itemRefs.current.set(slotIndex, el);
            else itemRefs.current.delete(slotIndex);
          }}
          className="relative z-10 flex flex-shrink-0 items-center gap-3"
        >
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
              className={`flex-shrink-0 ${events[slotIndex - 1].id === highlightEventId ? "last-placed-highlight" : ""}`}
            />
          ) : null}
          <TimelineSlot index={slotIndex} />
        </div>
      ))}
    </div>
  );
}
