"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DndContext, pointerWithin, type DragEndEvent } from "@dnd-kit/core";
import type { TimelineEvent } from "@/lib/types";
import { Timeline, parseSlotIndexFromId } from "@/components/Timeline";
import { EventCard } from "@/components/EventCard";
import { formatYear } from "@/lib/format";
import type { RoomState } from "@/src/services/roomApi";

const DRAGGABLE_ID = "current-card";

function timelineFromRoomState(state: RoomState): TimelineEvent[] {
  return [...state.timeline]
    .sort((a, b) => a.position - b.position)
    .map((e) => ({
      id: e.event.id,
      title: e.event.title,
      year: e.event.year,
      description: e.event.displayTitle,
      image: e.event.image,
      wikipediaUrl: e.event.wikipediaUrl,
    }));
}

type RoomGameBoardProps = {
  roomId: string;
  playerId: string;
  roomState: RoomState;
  wsReady: boolean;
  placeResult: {
    correct: boolean;
    gameEnded?: boolean;
    score: number;
    nextTurnPlayerId?: string | null;
  } | null;
  placeError: string | null;
  onClearPlaceError: () => void;
  roomError: string | null;
  onClearRoomError: () => void;
  onPlaceEvent: (eventId: string, position: number) => void;
  onTurnTimeout: () => void;
  onRematch: () => void;
  onEndGame: () => void;
  onCloseRoom?: () => void;
  onClearPlaceResult: () => void;
};

export function RoomGameBoard({
  roomId,
  playerId,
  roomState,
  wsReady,
  placeResult,
  placeError,
  onClearPlaceError,
  roomError,
  onClearRoomError,
  onPlaceEvent,
  onTurnTimeout,
  onRematch,
  onEndGame,
  onCloseRoom,
  onClearPlaceResult,
}: RoomGameBoardProps) {
  const timeline = timelineFromRoomState(roomState);
  const [lastPlacedId, setLastPlacedId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const placedCardRef = useRef<HTMLDivElement | null>(null);
  const timeoutFiredRef = useRef(false);

  const isMyTurn =
    roomState.status === "playing" &&
    roomState.currentTurnPlayerId === playerId;
  const currentTurnPlayer = roomState.players.find(
    (p) => p.playerId === roomState.currentTurnPlayerId,
  );
  const turnTimeLimitSeconds = roomState.turnTimeLimitSeconds ?? null;
  const currentTurnStartedAt = roomState.currentTurnStartedAt;

  useEffect(() => {
    if (!isMyTurn || turnTimeLimitSeconds == null || !currentTurnStartedAt) {
      setSecondsLeft(null);
      timeoutFiredRef.current = false;
      return;
    }
    const iso =
      typeof currentTurnStartedAt === "string" &&
      currentTurnStartedAt.length === 19 &&
      !currentTurnStartedAt.endsWith("Z")
        ? `${currentTurnStartedAt}Z`
        : currentTurnStartedAt;
    const started = new Date(iso).getTime();
    const limitMs = turnTimeLimitSeconds * 1000;

    const tick = () => {
      const elapsed = Date.now() - started;
      const left = Math.ceil((limitMs - elapsed) / 1000);
      if (left <= 0) {
        setSecondsLeft(0);
        if (!timeoutFiredRef.current) {
          timeoutFiredRef.current = true;
          onTurnTimeout();
        }
        return;
      }
      setSecondsLeft(left);
    };

    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [isMyTurn, turnTimeLimitSeconds, currentTurnStartedAt, onTurnTimeout]);

  const currentTurnEvent = roomState.status === "playing" && roomState.currentTurnEvent
    ? {
        id: roomState.currentTurnEvent.id,
        title: roomState.currentTurnEvent.title,
        year: roomState.currentTurnEvent.year,
        description: roomState.currentTurnEvent.displayTitle,
        image: roomState.currentTurnEvent.image,
        wikipediaUrl: roomState.currentTurnEvent.wikipediaUrl,
      } as TimelineEvent
    : null;

  useEffect(() => {
    if (!placeResult) return;
    const t = setTimeout(onClearPlaceResult, 3000);
    return () => clearTimeout(t);
  }, [placeResult, onClearPlaceResult]);

  useEffect(() => {
    if (!lastPlacedId) return;
    const t = setTimeout(() => {
      placedCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }, 500);
    const t2 = setTimeout(() => setLastPlacedId(null), 1500);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [lastPlacedId]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!currentTurnEvent || event.active.id !== DRAGGABLE_ID) return;
      const slotIndex = parseSlotIndexFromId(
        (event.over?.id as string | null | undefined) ?? null,
      );
      const validRange = 0 <= (slotIndex ?? -1) && (slotIndex ?? -1) <= timeline.length;
      if (slotIndex == null || !validRange) {
        setDropHint("Drop the card in a space between events (drop zone)");
        setTimeout(() => setDropHint(null), 3000);
        return;
      }
      setDropHint(null);
      setLastPlacedId(currentTurnEvent.id);
      onPlaceEvent(currentTurnEvent.id, slotIndex);
    },
    [currentTurnEvent, onPlaceEvent, timeline.length],
  );

  const myScore = roomState.scores[playerId] ?? 0;
  const isEnded = roomState.status === "ended";
  const winner = roomState.players.find(
    (p) => p.playerId === roomState.winnerPlayerId,
  );
  const isHost = roomState.hostPlayerId === playerId;

  return (
    <div className="page-bg flex min-h-screen flex-col text-zinc-900">
      <header className="flex-shrink-0 border-b border-zinc-200/80 bg-white/90 px-6 py-5 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 md:text-2xl">
              {roomState.name || "Party Timeliners"}
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500 md:text-sm">
              {isEnded
                ? winner
                  ? `Game over — ${winner.nickname} wins`
                  : "Game over — Tie"
                : isMyTurn
                  ? "Your turn — place the card on the timeline"
                  : currentTurnPlayer
                    ? `Waiting for ${currentTurnPlayer.nickname}…`
                    : "Loading…"}
            </p>
            {!isEnded && isMyTurn && turnTimeLimitSeconds != null && secondsLeft != null && (
              <div className="mt-2 w-full max-w-xs">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{secondsLeft}s</span>
                  <span>Limit: {turnTimeLimitSeconds}s</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-500"
                    style={{
                      width: `${Math.max(0, (secondsLeft / turnTimeLimitSeconds) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          {!isEnded && isHost && (
            <button
              type="button"
              onClick={onEndGame}
              className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 transition-all duration-200 ease hover:bg-amber-100"
            >
              End game
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1100px] flex-1 gap-6 px-6 py-8">
        <main className="relative flex min-w-0 flex-1 flex-col gap-8">
        {isEnded && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/95 px-6 py-6 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
              Final result
            </h2>
            <p className="mt-2 text-lg font-semibold text-amber-900">
              {winner ? `${winner.nickname} wins` : "Tie"}
            </p>
            <ul className="mt-3 space-y-2">
              {roomState.players
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .map((p) => (
                  <li
                    key={p.playerId}
                    className="flex justify-between rounded-lg bg-white/80 px-3 py-2"
                  >
                    <span className="font-medium text-zinc-900">
                      {p.nickname}
                      {p.playerId === playerId && " (you)"}
                    </span>
                    <span className="text-zinc-600">{p.score} pts</span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {isEnded ? (
          <>
            <section className="flex flex-1 flex-col gap-4 overflow-hidden rounded-2xl bg-white p-6 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Timeline
                </h2>
              </div>
              <div className="min-h-[140px] overflow-x-auto overflow-y-visible">
                <Timeline
                  events={timeline}
                  lastPlacedId={null}
                  onPlacedCardRef={() => {}}
                />
              </div>
            </section>
            {roomError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              >
                <span>{roomError}</span>
                <button
                  type="button"
                  onClick={onClearRoomError}
                  className="shrink-0 rounded p-1 text-amber-600 hover:bg-amber-100 hover:text-amber-900"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            )}
            <section className="flex flex-wrap items-center gap-4">
              {isHost && onCloseRoom ? (
                <button
                  type="button"
                  onClick={onCloseRoom}
                  className="rounded-[10px] border border-zinc-300 bg-white px-5 py-3 font-semibold text-zinc-700 transition-all duration-200 ease hover:bg-zinc-50"
                >
                  End
                </button>
              ) : (
                <Link
                  href="/"
                  className="rounded-[10px] border border-zinc-300 bg-white px-5 py-3 font-semibold text-zinc-700 transition-all duration-200 ease hover:bg-zinc-50"
                >
                  End game
                </Link>
              )}
              {isHost && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="rounded-[10px] bg-violet-600 px-5 py-3 font-semibold text-white shadow-sm transition-all duration-200 ease hover:bg-violet-700 hover:shadow-md"
                >
                  Rematch
                </button>
              )}
              {!isHost && (
                <p className="text-sm text-zinc-500">
                  The host can start a rematch
                </p>
              )}
            </section>
          </>
        ) : (
          <DndContext collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
            {/* Place result as overlay toast so timeline doesn't move */}
            {placeResult && (
              <div className="absolute left-0 right-0 top-0 z-20 px-0 pt-0">
                <section
                  role="status"
                  className={`rounded-xl border px-5 py-3 text-sm shadow-lg ${
                    placeResult.correct
                      ? "border-emerald-200 bg-emerald-50/98 text-emerald-900"
                      : "border-amber-200 bg-amber-50/98 text-amber-900"
                  }`}
                >
                  {placeResult.correct ? (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-wide">Correct</div>
                      <p>Your score: {placeResult.score}</p>
                    </>
                  ) : placeResult.gameEnded ? (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-wide">Game over</div>
                      <p>Final score: {placeResult.score}</p>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-wide">No points — game continues</div>
                      <p>Your score: {placeResult.score}</p>
                    </>
                  )}
                </section>
              </div>
            )}

            {placeError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              >
                <span>{placeError}</span>
                <button
                  type="button"
                  onClick={onClearPlaceError}
                  className="shrink-0 rounded p-1 text-amber-600 hover:bg-amber-100 hover:text-amber-900"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            )}

            {dropHint && (
              <div
                role="status"
                className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800"
              >
                {dropHint}
              </div>
            )}

            <section className="flex flex-1 flex-col gap-4 overflow-hidden rounded-2xl bg-white p-6 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Timeline
                </h2>
                <p className="text-[11px] text-zinc-400">
                  {isMyTurn ? "Drop the card between events" : "Watch the timeline"}
                </p>
              </div>
              <div className="min-h-[160px] overflow-x-auto overflow-y-visible">
                <Timeline
                  events={timeline}
                  lastPlacedId={lastPlacedId}
                  onPlacedCardRef={(el) => {
                    placedCardRef.current = el;
                  }}
                />
              </div>
            </section>

            <section
              className={`flex flex-shrink-0 flex-col gap-4 rounded-2xl p-6 shadow-[0_6px_20px_rgba(0,0,0,0.08)] transition-all duration-200 ${
                isMyTurn
                  ? "bg-violet-50/90 ring-2 ring-violet-400 ring-offset-2 ring-offset-[#eef2ff]"
                  : "bg-white/80"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Card to place
                </h2>
                {currentTurnPlayer && (
                  <p className={isMyTurn ? "text-sm font-semibold text-violet-700" : "text-xs text-zinc-500"}>
                    {isMyTurn ? "Your turn — drag the card to the timeline" : `Active: ${currentTurnPlayer.nickname}`}
                  </p>
                )}
              </div>
              {!wsReady ? (
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-sm text-zinc-400">
                  Connecting…
                </div>
              ) : currentTurnEvent ? (
                <div className="flex justify-center md:justify-start">
                  <EventCard
                    event={currentTurnEvent}
                    showYear={false}
                    revealed={false}
                    draggable={isMyTurn}
                    draggableId={DRAGGABLE_ID}
                    className={isMyTurn ? "touch-manipulation ring-2 ring-violet-400 ring-offset-2 ring-offset-white" : undefined}
                  />
                </div>
              ) : (
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/80 text-center text-sm text-zinc-500">
                  Loading…
                </div>
              )}
            </section>
          </DndContext>
        )}
        </main>

        <aside className="flex w-56 flex-shrink-0 flex-col gap-4 rounded-[14px] bg-white p-4 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Players
          </h2>
          <ul className="space-y-2">
            {roomState.players
              .sort((a, b) => (a.turnOrder ?? 999) - (b.turnOrder ?? 999))
              .map((p) => {
                const isCurrentTurn = roomState.status === "playing" && roomState.currentTurnPlayerId === p.playerId;
                const score = roomState.scores[p.playerId] ?? 0;
                return (
                  <li
                    key={p.playerId}
                    className={`flex flex-col gap-1.5 rounded-lg px-3 py-2 ${
                      isCurrentTurn ? "bg-violet-50 ring-1 ring-violet-200" : "bg-zinc-50"
                    }`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate font-medium text-zinc-900">
                        {p.nickname}
                        {p.playerId === playerId && " (you)"}
                      </span>
                      <span className="flex-shrink-0 text-sm font-medium text-zinc-600">
                        {score} pts
                      </span>
                    </div>
                    {isCurrentTurn && (
                      <span className="inline-block w-fit rounded-full bg-violet-200/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800">
                        Current active player
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
