"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { TimelineEvent } from "@/lib/types";
import { EventCard } from "@/components/EventCard";
import { EventDetailModal } from "@/components/EventDetailModal";
import { PlayersModal } from "@/components/PlayersModal";
import { getWikimediaThumbnail } from "@/lib/imageUtils";
import { formatYear } from "@/lib/format";
import type { RoomState } from "@/src/services/roomApi";
import { getMobileResultsGroups, ordinal } from "@/src/utils/mobileResults";
import { fireSuccessConfetti } from "@/src/utils/confetti";
import { fireVictoryConfetti } from "@/src/utils/victoryConfetti";
import { playSound, stopTickSound } from "@/src/utils/sound";
import { StreakMilestoneBanner } from "@/components/StreakMilestoneBanner";

function timelineEventsFromRoomState(state: RoomState): TimelineEvent[] {
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

export type MobileGameBoardProps = {
  roomId: string;
  playerId: string;
  roomState: RoomState;
  wsReady: boolean;
  placeResult: {
    correct: boolean;
    gameEnded?: boolean;
    score: number;
    streak?: number;
    nextTurnPlayerId?: string | null;
    correctPosition?: number;
  } | null;
  /** From parent useStreakMilestoneCallout(placeResult) */
  streakMilestoneMessage?: string | null;
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
  placingPending: { eventId: string; position: number } | null;
  rematchStarting: boolean;
  closeRoomStarting: boolean;
};

export function MobileGameBoard({
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
  streakMilestoneMessage = null,
  placingPending,
  rematchStarting,
  closeRoomStarting,
}: MobileGameBoardProps) {
  const resultsCtaBusy = rematchStarting || closeRoomStarting;
  const timeline = timelineEventsFromRoomState(roomState);
  const sortedTimelineEntries = useMemo(
    () => [...roomState.timeline].sort((a, b) => a.position - b.position),
    [roomState.timeline],
  );

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetailEvent, setEventDetailEvent] = useState<TimelineEvent | null>(null);
  const [eventDetailPlacedBy, setEventDetailPlacedBy] = useState<string | null>(null);
  const [showPlayers, setShowPlayers] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timeoutFiredRef = useRef(false);
  const victoryConfettiFiredRef = useRef(false);
  const defeatEffectFiredRef = useRef(false);

  const isMyTurn =
    roomState.status === "playing" && roomState.currentTurnPlayerId === playerId;
  const currentTurnPlayer = roomState.players.find(
    (p) => p.playerId === roomState.currentTurnPlayerId,
  );
  const turnTimeLimitSeconds = roomState.turnTimeLimitSeconds ?? null;
  const currentTurnStartedAt = roomState.currentTurnStartedAt;

  useEffect(() => {
    if (!isMyTurn || turnTimeLimitSeconds == null || !currentTurnStartedAt) {
      const id = setTimeout(() => setSecondsLeft(null), 0);
      stopTickSound();
      return () => clearTimeout(id);
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

  useEffect(() => {
    if (!placeResult) return;
    const t = setTimeout(onClearPlaceResult, 2800);
    return () => clearTimeout(t);
  }, [placeResult, onClearPlaceResult]);

  useEffect(() => {
    if (placeResult?.correct) {
      fireSuccessConfetti();
      playSound("correct");
      const id = setTimeout(() => setSelectedEventId(null), 0);
      return () => clearTimeout(id);
    }
  }, [placeResult?.correct]);

  useEffect(() => {
    if (placeResult && !placeResult.correct) playSound("wrong");
  }, [placeResult]);

  useEffect(() => {
    if (roomState.status !== "ended" || !roomState.winnerPlayerId) return;
    const isWinner = roomState.winnerPlayerId === playerId;
    if (isWinner) {
      if (!victoryConfettiFiredRef.current) {
        victoryConfettiFiredRef.current = true;
        fireVictoryConfetti();
        playSound("victory");
      }
    } else {
      if (!defeatEffectFiredRef.current) {
        defeatEffectFiredRef.current = true;
        playSound("defeat");
      }
    }
  }, [roomState.status, roomState.winnerPlayerId, playerId]);

  const myHand = useMemo(() => roomState.myHand ?? [], [roomState.myHand]);
  const myHandAsTimelineEvents: TimelineEvent[] = useMemo(
    () =>
      myHand.map((e) => ({
        id: e.id,
        title: e.title,
        year: e.year,
        description: e.displayTitle ?? e.title,
        image: e.image,
        wikipediaUrl: e.wikipediaUrl,
      })),
    [myHand],
  );

  const handCardsForUi = useMemo(
    () =>
      placingPending
        ? myHandAsTimelineEvents.filter((e) => e.id !== placingPending.eventId)
        : myHandAsTimelineEvents,
    [myHandAsTimelineEvents, placingPending],
  );

  /** While a place is in flight, hide selection in the UI without syncing state in an effect. */
  const effectiveSelectedEventId = placingPending ? null : selectedEventId;

  const lastPlacedEvent = roomState.lastPlacedEvent ?? null;
  const isEnded = roomState.status === "ended";
  const winner = roomState.players.find(
    (p) => p.playerId === roomState.winnerPlayerId,
  );
  const isHost = roomState.hostPlayerId === playerId;
  const { rankedPlayers, podiumCount, restRanked, podiumExtraPlayers } = useMemo(
    () => getMobileResultsGroups(roomState.players, roomState.winnerPlayerId),
    [roomState.players, roomState.winnerPlayerId],
  );

  const handlePlaceAt = useCallback(
    (position: number) => {
      if (effectiveSelectedEventId == null || !isMyTurn || placingPending) return;
      onPlaceEvent(effectiveSelectedEventId, position);
    },
    [effectiveSelectedEventId, isMyTurn, onPlaceEvent, placingPending],
  );

  const placeSlotClassName =
    "mobile-place-slot flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/80 text-violet-700 disabled:border-zinc-200 disabled:bg-zinc-50 disabled:text-zinc-400";

  const renderMobilePlaceSlot = (position: number, slotKey: string) => {
    if (placingPending?.position === position) {
      return (
        <div
          key={slotKey}
          className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-violet-400 bg-violet-100/90 text-violet-800 shadow-sm ring-2 ring-violet-300"
          role="status"
          aria-live="polite"
          aria-label="Checking placement"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
          <span className="mt-1 text-center text-[8px] font-bold uppercase leading-tight text-violet-900">
            Wait
          </span>
        </div>
      );
    }
    return (
      <button
        key={slotKey}
        type="button"
        disabled={!isMyTurn || effectiveSelectedEventId == null}
        onClick={() => handlePlaceAt(position)}
        className={placeSlotClassName}
        aria-label="Place here"
      >
        <span className="text-[11px] leading-none" aria-hidden>
          ↑
        </span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide">here</span>
      </button>
    );
  };

  function openEventDetail(event: TimelineEvent, placedByPlayerId: string | null) {
    const nickname = placedByPlayerId
      ? roomState.players.find((p) => p.playerId === placedByPlayerId)?.nickname ?? null
      : null;
    setEventDetailPlacedBy(nickname);
    setEventDetailEvent(event);
  }

  return (
    <div className="game-room-root flex min-h-screen flex-col text-zinc-900">
      <div className="game-background" aria-hidden />
      <div className="game-background-overlay" aria-hidden />
      <StreakMilestoneBanner message={streakMilestoneMessage} className="max-sm:top-16" />

      {(placeError || roomError) && (
        <div className="error-toast-container" role="alert" aria-live="polite">
          {placeError && (
            <div className="error-toast error-toast-enter">
              <span>{placeError}</span>
              <button
                type="button"
                onClick={onClearPlaceError}
                className="shrink-0 rounded p-1 text-white/90 hover:bg-white/20"
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
                className="shrink-0 rounded p-1 text-white/90 hover:bg-white/20"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {placeResult && (
        <div className="fixed left-0 right-0 top-4 z-50 flex justify-center px-4 pointer-events-none">
          <div
            role="status"
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm pointer-events-none ${
              placeResult.correct
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {placeResult.correct ? "Correct!" : "Wrong spot"} — Score: {placeResult.score}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200/80 bg-white/95 px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => setShowPlayers(true)}
          className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700"
        >
          <span aria-hidden>👥</span>
          Players
        </button>
        <div className="min-w-0 flex-1 text-center">
          {isEnded ? (
            <p className="truncate text-sm font-medium text-zinc-600">
              {winner ? `Game over — ${winner.nickname} wins` : "Game over — Tie"}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <p
                className={`truncate text-sm font-medium ${
                  isMyTurn ? "rounded-full bg-violet-50 px-3 py-1 text-violet-800 shadow-sm" : "text-zinc-700"
                }`}
              >
                {isMyTurn
                  ? placingPending
                    ? "Checking play…"
                    : "Your turn"
                  : currentTurnPlayer
                    ? `${currentTurnPlayer.nickname}'s turn`
                    : "Loading…"}
              </p>
              {!isEnded && isMyTurn && secondsLeft != null && (
                <p className="text-xs font-semibold text-violet-700">{secondsLeft}s left</p>
              )}
            </div>
          )}
        </div>
        {!isEnded ? (
          isHost ? (
            <button
              type="button"
              onClick={onEndGame}
              className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700"
            >
              End game
            </button>
          ) : onLeaveRoom ? (
            <button
              type="button"
              onClick={onLeaveRoom}
              className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700"
            >
              Leave
            </button>
          ) : (
            <div className="w-16" />
          )
        ) : (
          <div className="w-16" />
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        {/* Last placed event */}
        {(roomState.status === "playing" || roomState.status === "ended") && (
          <section
            className="mobile-last-placed shrink-0 rounded-xl border border-zinc-200/80 bg-white/90 p-2 shadow-sm backdrop-blur"
            aria-label="Last placed event"
          >
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              Last Placed Event
            </h2>
            {lastPlacedEvent ? (
              <button
                type="button"
                className="w-full rounded-lg bg-white/60 px-3 py-2 text-left shadow-sm ring-1 ring-zinc-200/60 transition hover:bg-white/80"
                onClick={() =>
                  openEventDetail(
                    {
                      id: lastPlacedEvent.eventId,
                      title: lastPlacedEvent.title,
                      year: lastPlacedEvent.year,
                      description: lastPlacedEvent.title,
                      image: lastPlacedEvent.image ?? undefined,
                    },
                    lastPlacedEvent.placedByPlayerId,
                  )
                }
              >
                <div className="flex items-center gap-3">
                  {lastPlacedEvent.image ? (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100/60">
                      {/* External Wikimedia URL, no next/image config */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getWikimediaThumbnail(lastPlacedEvent.image)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-100/60 text-[10px] font-semibold text-zinc-500">
                      No image
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      Placed by:{" "}
                      {roomState.players.find(
                        (p) => p.playerId === lastPlacedEvent.placedByPlayerId,
                      )?.nickname ?? "—"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm font-bold leading-tight text-zinc-900">
                      {lastPlacedEvent.title}
                    </p>
                    <div className="mt-1">
                      <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                        {formatYear(lastPlacedEvent.year)}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold text-zinc-500">
                      Tap for info
                    </p>
                  </div>
                </div>
              </button>
            ) : (
              <p className="text-xs text-zinc-400">No event placed yet</p>
            )}
          </section>
        )}

        {/* Timeline: place slots + years; tap year = modal */}
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <section className="flex h-44 flex-col gap-1 overflow-hidden rounded-xl border border-zinc-200/80 bg-white/90 p-2 shadow-sm backdrop-blur">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              Timeline
            </h2>
            {isMyTurn && (
              <p className="shrink-0 text-center text-sm font-medium text-zinc-700">
                {placingPending
                  ? "Checking your play…"
                  : effectiveSelectedEventId
                    ? "Tap a slot on the timeline to place the card"
                    : "Select a card"}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-visible pb-1">
              <div className="mobile-timeline flex items-center gap-1 py-1" style={{ minWidth: "min-content" }}>
              {sortedTimelineEntries.length === 0 ? (
                renderMobilePlaceSlot(0, "slot-0")
              ) : (
                <>
                  {renderMobilePlaceSlot(0, "slot-0")}

                  {sortedTimelineEntries.map((entry, index) => {
                    const event = timeline.find((e) => e.id === entry.event.id) ?? {
                      id: entry.event.id,
                      title: entry.event.title,
                      year: entry.event.year,
                      description: entry.event.displayTitle,
                      image: entry.event.image,
                      wikipediaUrl: entry.event.wikipediaUrl,
                    };

                    const positionAfter = index + 1;

                    return (
                      <div key={entry.event.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEventDetail(event, entry.placedByPlayerId ?? null)}
                          className="mobile-timeline-year flex h-14 w-20 shrink-0 flex-col items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-zinc-200 transition hover:ring-violet-300 active:bg-zinc-50/50"
                        >
                          <span className="text-sm font-bold text-zinc-900">
                            {entry.event.year}
                          </span>
                          <span className="text-[10px] font-medium text-zinc-500">
                            Tap for info
                          </span>
                        </button>

                        {renderMobilePlaceSlot(positionAfter, `slot-after-${entry.event.id}`)}
                      </div>
                    );
                  })}
                </>
              )}
              </div>
            </div>
          </section>
        </div>

        {/* Player hand */}
        <section className="flex shrink-0 flex-col gap-2 rounded-xl border border-zinc-200/80 bg-white/90 p-3 shadow-sm backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Your hand
          </h2>
          {!wsReady ? (
            <div className="flex h-28 items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-400">
              Connecting…
            </div>
          ) : myHand.length > 0 ? (
            <>
              {isMyTurn && (
                <p className="text-sm text-zinc-600">
                  {placingPending
                    ? "Hang on — verifying your card…"
                    : effectiveSelectedEventId
                      ? "Tap a slot on the timeline to place the card"
                      : "Select a card"}
                </p>
              )}
              <div className="flex gap-3 overflow-x-auto pb-2">
              {handCardsForUi.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() =>
                    isMyTurn &&
                    !placingPending &&
                    setSelectedEventId((id) => (id === ev.id ? null : ev.id))
                  }
                  className={`mobile-hand-card shrink-0 transition ${
                    effectiveSelectedEventId === ev.id
                      ? "ring-2 ring-violet-500 ring-offset-2 scale-[1.02]"
                      : ""
                  }`}
                >
                  <EventCard
                    event={ev}
                    showYear={false}
                    revealed={false}
                    className="pointer-events-none"
                  />
                </button>
              ))}
              </div>
            </>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
              Loading…
            </div>
          )}
        </section>
      </div>

      {isEnded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 pointer-events-none">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Match results"
            className="pointer-events-auto w-full max-w-[520px] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 bg-white p-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Match Results
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {winner ? "Winner and podium standings" : "Tie standings"}
                </p>
              </div>
              <div className="w-20" aria-hidden />
            </div>

            <div className="p-4">
              {(rematchStarting || closeRoomStarting) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-3 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-medium text-violet-900"
                >
                  <span
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"
                    aria-hidden
                  />
                  <span>
                    {closeRoomStarting
                      ? isHost
                        ? "Closing the room…"
                        : "The host is closing the room…"
                      : "Returning to lobby…"}
                  </span>
                </div>
              )}
              {winner ? (
                <div className="mb-4 rounded-xl bg-violet-50/80 p-3 ring-1 ring-violet-200/60">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-2xl"
                      aria-hidden
                    >
                      🏆
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-zinc-900">
                        {winner.nickname}
                        {winner.playerId === playerId ? " (you)" : ""}
                      </div>
                      <div className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-violet-800">
                        Winner
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white">
                      {winner.score ?? 0} pts
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-4 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/60">
                  <p className="text-sm font-bold text-zinc-900">It&apos;s a tie!</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Top players and final ranking
                  </p>
                </div>
              )}

              {winner ? (
                <div className={podiumExtraPlayers.length > 0 ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
                  {podiumExtraPlayers.length > 0 && (
                    <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200/60">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Podium
                      </h3>
                      <ul className="mt-2 space-y-2">
                        {podiumExtraPlayers.map((p, i) => {
                          const icon = i === 0 ? "🥈" : "🥉";
                          return (
                            <li
                              key={p.playerId}
                              className="flex items-center justify-between gap-3 rounded-lg bg-violet-50/60 px-2.5 py-2 ring-1 ring-violet-200/60"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span aria-hidden className="text-lg">
                                  {icon}
                                </span>
                                <span className="truncate text-sm font-semibold text-zinc-900">
                                  {p.nickname}
                                  {p.playerId === playerId ? " (you)" : ""}
                                </span>
                              </div>
                              <span className="shrink-0 text-xs font-bold text-violet-800">
                                {p.score ?? 0} pts
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200/60">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                      Rest of participants
                    </h3>
                    {restRanked.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {restRanked.map((p, i) => (
                          <li
                            key={p.playerId}
                            className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-2.5 py-2 ring-1 ring-zinc-200/60"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 text-xs font-bold text-zinc-600">
                                {ordinal(i + podiumCount + 1)}
                              </span>
                              <span className="truncate text-sm font-medium text-zinc-900">
                                {p.nickname}
                                {p.playerId === playerId ? " (you)" : ""}
                              </span>
                            </div>
                            <span className="shrink-0 text-xs font-semibold text-zinc-700">
                              {p.score ?? 0} pts
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm font-medium text-zinc-500">
                        No other players
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200/60">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Final ranking
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {rankedPlayers.map((p, i) => (
                      <li
                        key={p.playerId}
                        className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-2.5 py-2 ring-1 ring-zinc-200/60"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-xs font-bold text-zinc-600">
                            {ordinal(i + 1)}
                          </span>
                          <span className="truncate text-sm font-medium text-zinc-900">
                            {p.nickname}
                            {p.playerId === playerId ? " (you)" : ""}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-zinc-700">
                          {p.score ?? 0} pts
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isHost ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {onCloseRoom && (
                    <button
                      type="button"
                      onClick={() => {
                        onCloseRoom();
                      }}
                      disabled={resultsCtaBusy}
                      className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-65"
                    >
                      {closeRoomStarting ? (
                        <>
                          <span
                            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"
                            aria-hidden
                          />
                          Closing…
                        </>
                      ) : (
                        "End"
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onRematch();
                    }}
                    disabled={resultsCtaBusy}
                    className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {rematchStarting ? (
                      <>
                        <span
                          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent"
                          aria-hidden
                        />
                        Wait…
                      </>
                    ) : (
                      "Play again"
                    )}
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {onLeaveRoom && (
                    <Link
                      href="/"
                      className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700"
                    >
                      Leave
                    </Link>
                  )}
                  <p className="text-xs text-zinc-500 sm:pl-3">
                    {rematchStarting
                      ? "Returning to lobby…"
                      : closeRoomStarting
                        ? "The host is closing the room…"
                        : "The host can start a rematch"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {eventDetailEvent && (
        <EventDetailModal
          event={eventDetailEvent}
          placedByNickname={eventDetailPlacedBy}
          onClose={() => {
            setEventDetailEvent(null);
            setEventDetailPlacedBy(null);
          }}
        />
      )}

      {showPlayers && (
        <PlayersModal
          players={roomState.players}
          currentTurnPlayerId={roomState.currentTurnPlayerId}
          myPlayerId={playerId}
          scores={roomState.scores}
          onClose={() => setShowPlayers(false)}
        />
      )}
    </div>
  );
}
