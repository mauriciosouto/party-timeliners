"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import type { TimelineEvent } from "@/lib/types";
import { Timeline, parseSlotIndexFromId } from "@/components/Timeline";
import { EventCard } from "@/components/EventCard";
import { formatYear } from "@/lib/format";
import { getNextEvent } from "@/src/services/EventService";

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

function generateRoomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}`;
}

export default function GameBoard() {
  const [roomId] = useState(generateRoomId);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [currentEvent, setCurrentEvent] = useState<TimelineEvent | null>(null);
  const [placedCount, setPlacedCount] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [score, setScore] = useState(0);
  const [lastPlacedId, setLastPlacedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const placedCardRef = useRef<HTMLDivElement | null>(null);

  // Each game/room starts with one random event from the pool as the timeline seed, then the first card to place.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const initialEvent = await getNextEvent(roomId);
      if (cancelled) return;
      if (initialEvent) {
        setTimeline([initialEvent]);
      }
      const firstCard = await getNextEvent(roomId);
      if (!cancelled) {
        setCurrentEvent(firstCard);
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const [loadingNextCard, setLoadingNextCard] = useState(false);

  const loadNextEvent = async () => {
    setLoadingNextCard(true);
    const next = await getNextEvent(roomId);
    setCurrentEvent(next);
    setLoadingNextCard(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!currentEvent) return;
    if (event.active.id !== DRAGGABLE_ID) return;

    const slotIndex = parseSlotIndexFromId(
      (event.over?.id as string | null | undefined) ?? null,
    );
    if (slotIndex == null) return;

    // Clear the placed card immediately and show loading until the next one arrives
    setCurrentEvent(null);
    setLoadingNextCard(true);

    const previous = slotIndex > 0 ? timeline[slotIndex - 1] : null;
    const next = slotIndex < timeline.length ? timeline[slotIndex] : null;

    let isCorrect = false;

    if (!previous && next) {
      isCorrect = currentEvent.year <= next.year;
    } else if (previous && !next) {
      isCorrect = previous.year <= currentEvent.year;
    } else if (previous && next) {
      isCorrect =
        previous.year <= currentEvent.year &&
        currentEvent.year <= next.year;
    } else {
      isCorrect = true;
    }

    const newTimeline = [...timeline];

    if (isCorrect) {
      newTimeline.splice(slotIndex, 0, currentEvent);
      setTimeline(newTimeline);
      setLastPlacedId(currentEvent.id);
      setScore((s) => s + 1);
      setFeedback({
        type: "correct",
        message: "Nice! You placed the event correctly in time.",
        detail: `${currentEvent.title} fits between the surrounding years.`,
      });
    } else {
      const correctIndex = getCorrectInsertIndex(timeline, currentEvent);
      newTimeline.splice(correctIndex, 0, currentEvent);
      setTimeline(newTimeline);
      setLastPlacedId(currentEvent.id);
      setFeedback({
        type: "incorrect",
        message: "Not quite. The event has been moved to its correct position.",
        detail: `${currentEvent.title} belongs ${formatYear(
          currentEvent.year,
        )}.`,
      });
    }

    setPlacedCount((c) => c + 1);
    void loadNextEvent();
  };

  useEffect(() => {
    if (!lastPlacedId) return;
    const t = setTimeout(() => {
      placedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 600);
    const t2 = setTimeout(() => setLastPlacedId(null), 1200);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [lastPlacedId]);

  const setPlacedCardRef = (el: HTMLDivElement | null) => {
    placedCardRef.current = el;
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 via-white to-slate-100 text-zinc-900">
      {/* Top: Game title + room */}
      <header className="flex-shrink-0 border-b border-zinc-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 md:text-2xl">
              Party Timeliners
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500 md:text-sm">
              Local single-player · Place each event on the timeline
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
            <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-xs font-bold">
              Score: {score}
            </span>
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-200">Placed: {placedCount}</span>
          </div>
        </div>
      </header>

      {/* Middle: Scrollable horizontal timeline */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        <DndContext onDragEnd={handleDragEnd}>
          <section className="flex flex-1 flex-col gap-3 overflow-hidden rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-zinc-200/60">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                Timeline
              </h2>
              <p className="text-[11px] text-zinc-400">
                Scroll horizontally · Drop between cards
              </p>
            </div>
            <div className="min-h-[140px] overflow-x-auto overflow-y-visible">
              {loading ? (
                <div className="flex min-h-[120px] items-center justify-center text-sm text-zinc-400">
                  Loading timeline…
                </div>
              ) : (
                <Timeline
                  events={timeline}
                  lastPlacedId={lastPlacedId}
                  onPlacedCardRef={setPlacedCardRef}
                />
              )}
            </div>
          </section>

          {/* Bottom: Current card to place */}
          <section className="flex flex-shrink-0 flex-col gap-3 rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-zinc-200/60">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                Your event
              </h2>
              <p className="text-[11px] text-zinc-400">
                Drag the card into a drop zone on the timeline
              </p>
            </div>

            {loading ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-sm text-zinc-400">
                Loading card…
              </div>
            ) : loadingNextCard ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-sm text-zinc-400">
                Loading next event…
              </div>
            ) : currentEvent ? (
              <div className="flex justify-center md:justify-start">
                <EventCard
                  event={currentEvent}
                  showYear={false}
                  revealed={false}
                  draggable
                  draggableId={DRAGGABLE_ID}
                  className="touch-manipulation"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/80 px-6 py-8 text-center">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Round complete
                </span>
                <p className="text-sm text-zinc-600">
                  You’ve placed all events for this round.
                </p>
              </div>
            )}
          </section>
        </DndContext>

        {feedback && (
          <section
            className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              feedback.type === "correct"
                ? "border-emerald-200 bg-emerald-50/95 text-emerald-900"
                : "border-amber-200 bg-amber-50/95 text-amber-900"
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-wide">
              {feedback.type === "correct" ? "Correct" : "Moved to correct spot"}
            </div>
            <p>{feedback.message}</p>
            {feedback.detail && (
              <p className="text-xs opacity-90">{feedback.detail}</p>
            )}
          </section>
        )}

        <p className="text-center text-[11px] text-zinc-400">
          Local single-player prototype · Events from Wikipedia/Wikidata
        </p>
      </main>
    </div>
  );
}
