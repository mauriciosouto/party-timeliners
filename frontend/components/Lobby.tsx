"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { RoomState } from "@/src/services/roomApi";
import { playJoinSound } from "@/src/utils/sound";

type LobbyProps = {
  roomId: string;
  playerId: string;
  roomState: RoomState;
  wsReady: boolean;
  roomError: string | null;
  onClearRoomError: () => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
};

export function Lobby({
  roomId,
  playerId,
  roomState,
  wsReady,
  roomError,
  onClearRoomError,
  onStartGame,
  onLeaveRoom,
}: LobbyProps) {
  const isHost = roomState.hostPlayerId === playerId;
  const [copied, setCopied] = useState(false);
  const prevPlayerCountRef = useRef<number | null>(null);

  useEffect(() => {
    const count = roomState.players.length;
    const prev = prevPlayerCountRef.current;
    prevPlayerCountRef.current = count;
    if (prev !== null && count > prev) {
      playJoinSound();
    }
  }, [roomState.players.length]);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/room/${roomId}`
      : "";

  const copyInviteLink = useCallback(() => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [inviteUrl]);

  return (
    <div className="hero-background flex min-h-screen flex-col page-container">
      <header className="mx-auto w-full max-w-[1100px]">
        <h1 className="text-xl font-bold text-white">{roomState.name || "Party Timeliners"}</h1>
        <div className="mt-3">
          <button
            type="button"
            onClick={copyInviteLink}
            className="rounded-[10px] border border-violet-300 bg-violet-50 px-[18px] py-2.5 text-sm font-semibold text-violet-700 transition-all duration-200 ease hover:-translate-y-px hover:bg-violet-100 hover:shadow-[0_6px_12px_rgba(0,0,0,0.1)]"
          >
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
          <li>Max events: {roomState.maxTimelineSize ?? 50}</li>
          <li>Points to win: {roomState.pointsToWin ?? 2}</li>
          <li>
            Turn time:{" "}
            {roomState.turnTimeLimitSeconds != null
              ? `${roomState.turnTimeLimitSeconds}s`
              : "No limit"}
          </li>
        </ul>
      </header>

      <main className="mx-auto mt-10 w-full max-w-[1100px] flex-1">
        <div className="glass-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Players ({roomState.players.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {roomState.players.map((p) => (
              <li
                key={p.playerId}
                className="player-row flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  {p.avatar ? (
                    <img
                      src={p.avatar}
                      alt=""
                      className="player-avatar h-9 w-9 shrink-0 rounded-full object-cover"
                      width={36}
                      height={36}
                    />
                  ) : (
                    <div
                      className="player-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600"
                      aria-hidden
                    >
                      {(p.nickname || "?")[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className="font-medium text-zinc-900">
                    {p.nickname}
                    {p.playerId === playerId && (
                      <span className="ml-2 text-xs text-zinc-500">(you)</span>
                    )}
                  </span>
                </div>
                {p.isHost && (
                  <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                    Host
                  </span>
                )}
              </li>
            ))}
          </ul>

          {!wsReady && (
            <p className="mt-3 text-sm text-amber-600">
              {roomState.players.length > 0 ? "Reconnecting…" : "Connecting…"}
            </p>
          )}

          {roomError && (
            <div
              role="alert"
              className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
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

          {isHost && wsReady && (
            <button
              onClick={onStartGame}
              className="mt-8 w-full rounded-[10px] bg-violet-600 px-[18px] py-2.5 font-semibold text-white shadow-sm transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-violet-700"
            >
              Start game
            </button>
          )}

          {!isHost && (
            <>
              <p className="mt-4 text-sm text-slate-300">Waiting for the host to start the game…</p>
              {wsReady && (
                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="mt-4 w-full rounded-[10px] border border-zinc-300 bg-zinc-100 px-[18px] py-2.5 text-sm font-semibold text-zinc-700 transition-all duration-200 ease hover:bg-zinc-200"
                >
                  Leave room
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
