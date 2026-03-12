"use client";

import { useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import type { TimelineEvent } from "@/lib/types";
import { INITIAL_TIMELINE, EVENT_POOL } from "@/lib/mockEvents";
import { Timeline, parseSlotIndexFromId } from "@/components/Timeline";
import { EventCard } from "@/components/EventCard";
import { formatYear } from "@/lib/format";

const DRAGGABLE_ID = "current-card";

type Feedback =
  | {
      type: "correct" | "incorrect";
      message: string;
      detail?: string;
    }
  | null;

function getCorrectInsertIndex(timeline: TimelineEvent[], event: TimelineEvent) {
  let i = 0;
  while (i < timeline.length && timeline[i].year <= event.year) {
    i += 1;
  }
  return i;
}

export default function GameBoard() {
  const [timeline, setTimeline] = useState<TimelineEvent[]>(INITIAL_TIMELINE);
  const [deckIndex, setDeckIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [score, setScore] = useState(0);

  const currentEvent = EVENT_POOL[deckIndex] ?? null;

  const handleDragEnd = (event: DragEndEvent) => {
    if (!currentEvent) return;
    if (event.active.id !== DRAGGABLE_ID) return;

    const slotIndex = parseSlotIndexFromId(
      (event.over?.id as string | null | undefined) ?? null,
    );
    if (slotIndex == null) return;

    console.log("onEventPlaced(position)", slotIndex);

    const previous = slotIndex > 0 ? timeline[slotIndex - 1] : null;
    const next = slotIndex < timeline.length ? timeline[slotIndex] : null;

    let isCorrect = false;

    if (!previous && next) {
      // Placed at the start.
      isCorrect = currentEvent.year <= next.year;
    } else if (previous && !next) {
      // Placed at the end.
      isCorrect = previous.year <= currentEvent.year;
    } else if (previous && next) {
      // Placed between two events.
      isCorrect =
        previous.year <= currentEvent.year &&
        currentEvent.year <= next.year;
    } else {
      // Empty timeline fallback.
      isCorrect = true;
    }

    const newTimeline = [...timeline];

    if (isCorrect) {
      // Insert at the chosen slot when placement is valid.
      newTimeline.splice(slotIndex, 0, currentEvent);
      setTimeline(newTimeline);

      setScore((s) => s + 1);
      setFeedback({
        type: "correct",
        message: "Nice! You placed the event correctly in time.",
        detail: `${currentEvent.title} fits between the surrounding years.`,
      });
    } else {
      // Insert at the correct chronological position when invalid.
      const correctIndex = getCorrectInsertIndex(timeline, currentEvent);
      newTimeline.splice(correctIndex, 0, currentEvent);
      setTimeline(newTimeline);

      setFeedback({
        type: "incorrect",
        message: "Not quite. The event has been moved to its correct position.",
        detail: `${currentEvent.title} belongs ${formatYear(
          currentEvent.year,
        )}.`,
      });
    }

    // Next mock event.
    setDeckIndex((i) => i + 1);
  };

  const placedEventsCount = timeline.length - INITIAL_TIMELINE.length;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-sky-50 via-indigo-50 to-fuchsia-50 text-zinc-900">
      <header className="border-b border-white/60 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
              Party Timeliners
            </h1>
            <p className="text-xs text-zinc-500">
              Drag each event into the shared history timeline.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-full bg-zinc-900 text-xs font-medium text-white shadow-sm">
            <div className="rounded-full bg-gradient-to-r from-sky-400 to-fuchsia-500 px-3 py-1">
              Score: {score}
            </div>
            <div className="px-3 py-1 text-zinc-200">
              Events placed: {placedEventsCount} / {EVENT_POOL.length}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5">
        <DndContext onDragEnd={handleDragEnd}>
          <section className="flex flex-col gap-3 rounded-3xl bg-white/80 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">Timeline</h2>
              <p className="text-[11px] text-zinc-500">
                Horizontal scroll supported. Earlier events appear to the left.
              </p>
            </div>
            <div className="overflow-x-auto pb-2">
              <div className="min-w-max pr-4">
                <Timeline events={timeline} />
              </div>
            </div>
          </section>

          <section className="mt-3 flex flex-col gap-3 rounded-3xl bg-white/80 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">
                Your event
              </h2>
              <p className="text-[11px] text-zinc-500">
                Drag the card above and drop it between two events.
              </p>
            </div>

            {currentEvent ? (
              <div>
                <EventCard
                  event={currentEvent}
                  label="Place this event"
                  showYear={false}
                  draggable
                  draggableId={DRAGGABLE_ID}
                  className="bg-white/95"
                />
                <div className="mt-1 text-right text-[10px] font-medium text-zinc-500">
                  Drag the card onto the timeline slots above.
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Prototype complete
                </span>
                <p className="text-sm">
                  You have placed all available events for this prototype round.
                </p>
              </div>
            )}
          </section>
        </DndContext>

        {feedback && (
          <section
            className={`mt-2 flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              feedback.type === "correct"
                ? "border-emerald-200 bg-emerald-50/90 text-emerald-900"
                : "border-rose-200 bg-rose-50/90 text-rose-900"
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-wide">
              {feedback.type === "correct" ? "Correct placement" : "Not quite"}
            </div>
            <p>{feedback.message}</p>
            {feedback.detail && (
              <p className="text-xs opacity-80">{feedback.detail}</p>
            )}
          </section>
        )}

        <section className="mt-3 text-[11px] text-zinc-500">
          <p>
            This is a local single-player prototype. In later phases we&apos;ll
            connect to real Wikipedia data, multiplayer rooms, and Durable
            Objects.
          </p>
        </section>
      </main>
    </div>
  );
}

