"use client";

import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import type { TimelineEvent } from "@/lib/types";
import { formatYear } from "@/lib/format";

export const SLOT_ID_PREFIX = "slot-";

export function makeSlotId(index: number): string {
  return `${SLOT_ID_PREFIX}${index}`;
}

export function parseSlotIndexFromId(id: string | null | undefined): number | null {
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
      className={`relative flex min-w-[140px] flex-col items-center justify-between gap-2 rounded-2xl border border-dashed border-zinc-300/80 bg-white/60 px-3 py-2 text-xs shadow-sm transition-colors ${
        isOver
          ? "border-indigo-400 bg-indigo-50/80"
          : "hover:border-zinc-400/80"
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        Drop here
      </span>
    </div>
  );
}

type TimelineProps = {
  events: TimelineEvent[];
};

export function Timeline({ events }: TimelineProps) {
  const slots = useMemo(
    () => Array.from({ length: events.length + 1 }, (_, i) => i),
    [events.length],
  );

  return (
    <div className="relative flex w-full items-center gap-4">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-zinc-300" />
      {slots.map((slotIndex) => (
        <div key={slotIndex} className="flex items-center gap-2">
          {slotIndex === 0 ? null : (
            <div className="flex flex-col items-center gap-1">
              <div className="h-3 w-[2px] rounded-full bg-zinc-300" />
              <div className="rounded-xl bg-white/90 px-3 py-2 text-xs shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {formatYear(events[slotIndex - 1].year)}
                </div>
                <div className="mt-0.5 font-semibold text-zinc-900">
                  {events[slotIndex - 1].title}
                </div>
              </div>
            </div>
          )}
          <TimelineSlot index={slotIndex} />
        </div>
      ))}
    </div>
  );
}

