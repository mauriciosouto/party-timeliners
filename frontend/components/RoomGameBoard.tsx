"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DndContext, pointerWithin, type DragEndEvent } from "@dnd-kit/core";
import type { TimelineEvent } from "@/lib/types";
import { Timeline, parseSlotIndexFromId } from "@/components/Timeline";
import { EventCard } from "@/components/EventCard";
import { formatYear } from "@/lib/format";
import { getNextEvent } from "@/src/services/roomApi";
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
  onClearPlaceResult,
}: RoomGameBoardProps) {
  const timeline = timelineFromRoomState(roomState);
  const [currentEvent, setCurrentEvent] = useState<TimelineEvent | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
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
          console.log("[RoomGameBoard] turn timeout fired, calling onTurnTimeout");
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
    if (
      roomState.status !== "playing" ||
      roomState.currentTurnPlayerId !== playerId
    ) {
      setCurrentEvent(null);
      return;
    }
    let cancelled = false;
    setLoadingCard(true);
    getNextEvent(roomId, playerId).then((ev) => {
      if (!cancelled && ev) {
        setCurrentEvent({
          id: ev.id,
          title: ev.title,
          year: ev.year,
          description: ev.displayTitle,
          image: ev.image,
          wikipediaUrl: ev.wikipediaUrl,
        });
      }
      if (!cancelled) setLoadingCard(false);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, playerId, roomState.status, roomState.currentTurnPlayerId]);

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
      if (!currentEvent || event.active.id !== DRAGGABLE_ID) return;
      const slotIndex = parseSlotIndexFromId(
        (event.over?.id as string | null | undefined) ?? null,
      );
      const validRange = 0 <= (slotIndex ?? -1) && (slotIndex ?? -1) <= timeline.length;
      if (slotIndex == null || !validRange) {
        console.log("[RoomGameBoard] handleDragEnd: invalid drop", { slotIndex, timelineLength: timeline.length });
        setDropHint("Suelta la carta en un espacio entre eventos (zona «drop»)");
        setTimeout(() => setDropHint(null), 3000);
        return;
      }
      console.log("[RoomGameBoard] handleDragEnd: placing", { eventId: currentEvent.id, slotIndex });
      setDropHint(null);
      setLastPlacedId(currentEvent.id);
      setCurrentEvent(null);
      onPlaceEvent(currentEvent.id, slotIndex);
    },
    [currentEvent, onPlaceEvent, timeline.length],
  );

  const myScore = roomState.scores[playerId] ?? 0;
  const isEnded = roomState.status === "ended";
  const winner = roomState.players.find(
    (p) => p.playerId === roomState.winnerPlayerId,
  );
  const isHost = roomState.hostPlayerId === playerId;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-slate-100 text-zinc-900">
      <header className="flex-shrink-0 border-b border-zinc-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 md:text-2xl">
              {roomState.name || "Party Timeliners"}
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500 md:text-sm">
              {isEnded
                ? winner
                  ? `Partida terminada — ${winner.nickname} gana`
                  : "Partida terminada — Empate"
                : isMyTurn
                  ? "Tu turno — coloca la carta en la línea"
                  : currentTurnPlayer
                    ? `Esperando a ${currentTurnPlayer.nickname}…`
                    : "Cargando…"}
            </p>
            {!isEnded && isMyTurn && turnTimeLimitSeconds != null && secondsLeft != null && (
              <div className="mt-2 w-full max-w-xs">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{secondsLeft}s</span>
                  <span>Límite: {turnTimeLimitSeconds}s</span>
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
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              Terminar partida
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-4 px-4 py-6">
        <main className="flex min-w-0 flex-1 flex-col gap-6">
        {isEnded && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
              Resultado final
            </h2>
            <p className="mt-2 text-lg font-semibold text-amber-900">
              {winner ? `${winner.nickname} gana` : "Empate"}
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
                      {p.playerId === playerId && " (tú)"}
                    </span>
                    <span className="text-zinc-600">{p.score} pts</span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {isEnded ? (
          <>
            <section className="flex flex-1 flex-col gap-3 overflow-hidden rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-zinc-200/60">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Línea de tiempo
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
                  aria-label="Cerrar"
                >
                  ×
                </button>
              </div>
            )}
            <section className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="rounded-lg border border-zinc-300 bg-white px-4 py-3 font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Terminar juego
              </Link>
              {isHost && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="rounded-lg bg-violet-600 px-4 py-3 font-medium text-white hover:bg-violet-700"
                >
                  Revancha
                </button>
              )}
              {!isHost && (
                <p className="text-sm text-zinc-500">
                  El host puede iniciar una revancha
                </p>
              )}
            </section>
          </>
        ) : (
          <DndContext collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
            {placeResult && (
              <section
                className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                  placeResult.correct
                    ? "border-emerald-200 bg-emerald-50/95 text-emerald-900"
                    : "border-amber-200 bg-amber-50/95 text-amber-900"
                }`}
              >
                {placeResult.correct ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide">Correcto</div>
                    <p>Tu puntaje: {placeResult.score}</p>
                  </>
                ) : placeResult.gameEnded ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide">Partida terminada</div>
                    <p>Puntaje final: {placeResult.score}</p>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide">No sumas puntos — sigue la partida</div>
                    <p>Tu puntaje: {placeResult.score}</p>
                  </>
                )}
              </section>
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
                  aria-label="Cerrar"
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

            <section className="flex flex-1 flex-col gap-3 overflow-hidden rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-zinc-200/60">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                  Línea de tiempo
                </h2>
                <p className="text-[11px] text-zinc-400">
                  {isMyTurn ? "Suelta la carta entre eventos" : "Observa la línea de tiempo"}
                </p>
              </div>
              <div className="min-h-[140px] overflow-x-auto overflow-y-visible">
                <Timeline
                  events={timeline}
                  lastPlacedId={lastPlacedId}
                  onPlacedCardRef={(el) => {
                    placedCardRef.current = el;
                  }}
                />
              </div>
            </section>

            <section className="flex flex-shrink-0 flex-col gap-3 rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-zinc-200/60">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                Tu evento
              </h2>
              {!wsReady ? (
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-sm text-zinc-400">
                  Conectando…
                </div>
              ) : loadingCard ? (
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-sm text-zinc-400">
                  Cargando carta…
                </div>
              ) : isMyTurn && currentEvent ? (
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
                <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/80 text-center text-sm text-zinc-500">
                  {isMyTurn ? "Cargando…" : "Espera tu turno"}
                </div>
              )}
            </section>
          </DndContext>
        )}
        </main>

        <aside className="flex w-56 flex-shrink-0 flex-col gap-3 rounded-2xl bg-white/90 p-4 shadow-md ring-1 ring-zinc-200/60">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Participantes
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
                        {p.playerId === playerId && " (tú)"}
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
