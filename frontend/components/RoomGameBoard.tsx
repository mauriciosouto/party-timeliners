"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DndContext, pointerWithin, useDndContext, type DragEndEvent } from "@dnd-kit/core";
import type { TimelineEvent } from "@/lib/types";
import type { TimelineProps } from "@/components/Timeline";
import { Timeline, parseSlotIndexFromId } from "@/components/Timeline";
import { EventCard } from "@/components/EventCard";
import type { RoomState } from "@/src/services/roomApi";
import { fireSuccessConfetti } from "@/src/utils/confetti";
import { fireVictoryConfetti } from "@/src/utils/victoryConfetti";
import { playSound, stopTickSound } from "@/src/utils/sound";


/** Wrapper so Timeline can show drag-active glow; must be used inside DndContext. */
function TimelineWithDragState(props: Omit<TimelineProps, "dragActive">) {
  const { active } = useDndContext();
  return <Timeline {...props} dragActive={active != null} />;
}

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
    correctPosition?: number;
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
  onLeaveRoom?: () => void;
  onClearPlaceResult: () => void;
};

export function RoomGameBoard({
  // roomId required by parent type but not used in this component
  roomId: _roomId, // eslint-disable-line @typescript-eslint/no-unused-vars
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
  onLeaveRoom,
  onClearPlaceResult,
}: RoomGameBoardProps) {
  const timeline = timelineFromRoomState(roomState);
  const [lastPlacedId, setLastPlacedId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const placedCardRef = useRef<HTMLDivElement | null>(null);
  const timeoutFiredRef = useRef(false);
  const victoryConfettiFiredRef = useRef(false);
  const defeatEffectFiredRef = useRef(false);
  const lastTickSecondRef = useRef<number | null>(null);
  const [showDefeatOverlay, setShowDefeatOverlay] = useState(false);

  function getTimerClasses(s: number): { text: string; bar: string } {
    if (s > 10) return { text: "timer-safe", bar: "timer-bar-safe" };
    if (s >= 6) return { text: "timer-warning", bar: "timer-bar-warning" };
    if (s >= 2) return { text: "timer-danger", bar: "timer-bar-danger" };
    if (s === 1) return { text: "timer-final timer-danger", bar: "timer-bar-final" };
    return { text: "timer-danger", bar: "timer-bar-danger" };
  }

  useEffect(() => {
    if (secondsLeft == null || secondsLeft > 3) {
      lastTickSecondRef.current = null;
      return;
    }
    if (secondsLeft >= 1 && secondsLeft <= 3 && lastTickSecondRef.current !== secondsLeft) {
      lastTickSecondRef.current = secondsLeft;
      playSound("tick");
    }
  }, [secondsLeft]);

  useEffect(() => {
    if (!placeError && !roomError) return;
    const t = setTimeout(() => {
      if (placeError) onClearPlaceError();
      if (roomError) onClearRoomError();
    }, 4000);
    return () => clearTimeout(t);
  }, [placeError, roomError, onClearPlaceError, onClearRoomError]);

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
      queueMicrotask(() => setSecondsLeft(null));
      timeoutFiredRef.current = false;
      stopTickSound();
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
        stopTickSound();
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

  const myHand = useMemo(
    () => roomState.myHand ?? [],
    [roomState.myHand],
  );

  useEffect(() => {
    if (!placeResult) return;
    const t = setTimeout(onClearPlaceResult, 3000);
    return () => clearTimeout(t);
  }, [placeResult, onClearPlaceResult]);

  useEffect(() => {
    if (placeResult?.correct) {
      fireSuccessConfetti();
      playSound("correct");
    }
  }, [placeResult?.correct]);

  useEffect(() => {
    if (placeResult && !placeResult.correct) {
      playSound("wrong");
    }
  }, [placeResult]);

  useEffect(() => {
    if (roomState.status !== "ended" || !roomState.winnerPlayerId) {
      victoryConfettiFiredRef.current = false;
      defeatEffectFiredRef.current = false;
      return;
    }
    const isWinner = roomState.winnerPlayerId === playerId;
    if (isWinner) {
      if (victoryConfettiFiredRef.current) return;
      victoryConfettiFiredRef.current = true;
      fireVictoryConfetti();
      playSound("victory");
    } else {
      if (defeatEffectFiredRef.current) return;
      defeatEffectFiredRef.current = true;
      playSound("defeat");
      queueMicrotask(() => setShowDefeatOverlay(true));
      const t = setTimeout(() => setShowDefeatOverlay(false), 800);
      return () => clearTimeout(t);
    }
  }, [roomState.status, roomState.winnerPlayerId, playerId]);

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
      const eventId = event.active.id as string;
      const handIds = new Set(myHand.map((e) => e.id));
      if (!handIds.has(eventId)) return;
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
      setLastPlacedId(eventId);
      onPlaceEvent(eventId, slotIndex);
    },
    [myHand, onPlaceEvent, timeline.length],
  );

  const isEnded = roomState.status === "ended";
  const winner = roomState.players.find(
    (p) => p.playerId === roomState.winnerPlayerId,
  );
  const isHost = roomState.hostPlayerId === playerId;

  const rankedPlayers = [...roomState.players].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );
  const playerCount = rankedPlayers.length;
  const podiumCount =
    playerCount <= 3 ? 1 : playerCount <= 5 ? 2 : 3;
  const restRanked = rankedPlayers.slice(podiumCount);

  function ordinal(n: number): string {
    const s = n % 100;
    if (s >= 11 && s <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  }

  return (
    <div className="game-room-root flex min-h-screen flex-col text-zinc-900">
      <div className="game-background" aria-hidden />
      <div className="game-background-overlay" aria-hidden />

      {(placeError || roomError) && (
        <div className="error-toast-container" role="alert" aria-live="polite">
          {placeError && (
            <div className="error-toast error-toast-enter">
              <span>{placeError}</span>
              <button
                type="button"
                onClick={onClearPlaceError}
                className="shrink-0 rounded p-1 text-white/90 hover:bg-white/20 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          )}
          {roomError && (
            <div className="error-toast error-toast-enter">
              <span>{roomError}</span>
              <button
                type="button"
                onClick={onClearRoomError}
                className="shrink-0 rounded p-1 text-white/90 hover:bg-white/20 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {showDefeatOverlay && (
        <div className="game-over-overlay defeat-effect" aria-hidden />
      )}
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
            {!isEnded && isMyTurn && turnTimeLimitSeconds != null && secondsLeft != null && (() => {
              const { text: timerTextClass, bar: timerBarClass } = getTimerClasses(secondsLeft);
              return (
                <div className="mt-2 w-full max-w-xs">
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span className={`font-semibold tabular-nums ${timerTextClass}`}>{secondsLeft}s</span>
                    <span>Limit: {turnTimeLimitSeconds}s</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${timerBarClass}`}
                      style={{
                        width: `${Math.max(0, (secondsLeft / turnTimeLimitSeconds) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
          {!isEnded && isHost && (
            <button
              type="button"
              onClick={onEndGame}
              className="rounded-[10px] border border-amber-300 bg-amber-50 px-[18px] py-2.5 text-sm font-semibold text-amber-800 transition-all duration-200 ease hover:-translate-y-px hover:bg-amber-100 hover:shadow-[0_6px_12px_rgba(0,0,0,0.1)]"
            >
              End game
            </button>
          )}
          {!isEnded && !isHost && onLeaveRoom && (
            <button
              type="button"
              onClick={onLeaveRoom}
              className="rounded-[10px] border border-zinc-300 bg-zinc-100 px-[18px] py-2.5 text-sm font-semibold text-zinc-700 transition-all duration-200 ease hover:-translate-y-px hover:bg-zinc-200"
            >
              Leave game
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1100px] flex-1 gap-6 px-6 py-8">
        <main className="relative flex min-w-0 flex-1 flex-col gap-8">
        {isEnded && (
          <section className="results-screen rounded-2xl bg-white p-8 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            <h2 className="results-title">Match Results</h2>

            {winner ? (
              <div className="results-content">
                <div className="winner-card">
                  <div className="winner-icon" aria-hidden>🏆</div>
                  {winner.avatar ? (
                    <img
                      src={winner.avatar}
                      alt=""
                      className="mx-auto mb-2 h-16 w-16 rounded-full object-cover"
                      width={64}
                      height={64}
                    />
                  ) : null}
                  <div className="winner-name">
                    {winner.nickname}
                    {winner.playerId === playerId && " (you)"}
                  </div>
                  <div className="winner-label">Winner</div>
                </div>
                <div className="player-ranking-wrapper">
                  <h3 className="player-ranking-title">
                    {restRanked.length > 0 ? "Ranking" : "No other players"}
                  </h3>
                  <ul className="player-ranking">
                    {restRanked.map((p, i) => (
                      <li key={p.playerId} className="flex items-center gap-3">
                        {p.avatar ? (
                          <img
                            src={p.avatar}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                            width={36}
                            height={36}
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600">
                            {(p.nickname || "?")[0]?.toUpperCase() ?? "?"}
                          </div>
                        )}
                        <span className="rank">{ordinal(i + 2)}</span>
                        <span className="name">
                          {p.nickname}
                          {p.playerId === playerId && " (you)"}
                        </span>
                        <span className="score">{p.score ?? 0} pts</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-4 text-lg font-semibold text-zinc-600">It&apos;s a tie!</p>
                <ul className="results-list results-ranking-list">
                  {rankedPlayers.map((p, i) => (
                    <li key={p.playerId}>
                      <strong>{ordinal(i + 1)}</strong>
                      <span>
                        {p.nickname}
                        {p.playerId === playerId && " (you)"}
                      </span>
                      <span>{p.score ?? 0} pts</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="results-actions flex flex-wrap items-center justify-center gap-4">
              {isHost && onCloseRoom ? (
                <button
                  type="button"
                  onClick={onCloseRoom}
                  className="rounded-[10px] border border-zinc-300 bg-white px-[18px] py-2.5 font-semibold text-zinc-700 transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.1)] hover:bg-zinc-50"
                >
                  End
                </button>
              ) : (
                <Link
                  href="/"
                  className="inline-block rounded-[10px] border border-zinc-300 bg-white px-[18px] py-2.5 font-semibold text-zinc-700 transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.1)] hover:bg-zinc-50"
                >
                  End game
                </Link>
              )}
              {isHost && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="rounded-[10px] bg-violet-600 px-[18px] py-2.5 font-semibold text-white shadow-sm transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-violet-700"
                >
                  Play again
                </button>
              )}
              {!isHost && (
                <p className="text-sm text-zinc-500">The host can start a rematch</p>
              )}
            </div>
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

            {dropHint && (
              <div
                role="status"
                className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800"
              >
                {dropHint}
              </div>
            )}

            <section
              className={`relative flex flex-1 flex-col gap-4 overflow-hidden rounded-2xl bg-white p-6 shadow-[0_6px_20px_rgba(0,0,0,0.08)] transition-[box-shadow,border-color] duration-300 ${
                placeResult
                  ? placeResult.correct
                    ? "ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-white"
                    : "ring-2 ring-amber-400/80 ring-offset-2 ring-offset-white"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Timeline
                </h2>
                {placeResult && (
                  <span
                    className={`place-feedback-in inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold shadow-sm ${
                      placeResult.correct
                        ? "bg-emerald-500 text-white"
                        : "bg-amber-500 text-white"
                    }`}
                    role="status"
                  >
                    {placeResult.correct ? "Correct!" : "Wrong spot"}
                  </span>
                )}
                {!placeResult && (
                  <p className="text-[11px] text-zinc-400">
                    {isMyTurn ? "Drop the card between events" : "Watch the timeline"}
                  </p>
                )}
              </div>
              <div
                className="min-h-[160px] overflow-x-auto overflow-y-visible"
                style={{ overscrollBehaviorX: "contain", overscrollBehaviorY: "auto" }}
              >
                <TimelineWithDragState
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
                  Your hand
                </h2>
                {currentTurnPlayer && (
                  <p className={isMyTurn ? "text-sm font-semibold text-violet-700" : "text-xs text-zinc-500"}>
                    {isMyTurn ? "Your turn — drag a card to the timeline" : `Active: ${currentTurnPlayer.nickname}`}
                  </p>
                )}
              </div>
              {!wsReady ? (
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-sm text-zinc-400">
                  Connecting…
                </div>
              ) : myHand.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-3 md:justify-start">
                  {myHand.map((ev) => (
                    <EventCard
                      key={ev.id}
                      event={ev}
                      showYear={false}
                      revealed={false}
                      draggable={isMyTurn}
                      draggableId={ev.id}
                      className={isMyTurn ? "touch-manipulation ring-2 ring-violet-400 ring-offset-2 ring-offset-white" : undefined}
                    />
                  ))}
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
                      <div className="flex min-w-0 items-center gap-2">
                        {p.avatar ? (
                          <img
                            src={p.avatar}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                            width={36}
                            height={36}
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600">
                            {(p.nickname || "?")[0]?.toUpperCase() ?? "?"}
                          </div>
                        )}
                        <span className="truncate font-medium text-zinc-900">
                          {p.nickname}
                          {p.playerId === playerId && " (you)"}
                        </span>
                      </div>
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
