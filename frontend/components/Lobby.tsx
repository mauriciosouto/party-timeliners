"use client";

import { useState, useCallback } from "react";
import type { RoomState } from "@/src/services/roomApi";

type LobbyProps = {
  roomId: string;
  playerId: string;
  roomState: RoomState;
  wsReady: boolean;
  roomError: string | null;
  onClearRoomError: () => void;
  onStartGame: () => void;
};

export function Lobby({
  roomId,
  playerId,
  roomState,
  wsReady,
  roomError,
  onClearRoomError,
  onStartGame,
}: LobbyProps) {
  const isHost = roomState.hostPlayerId === playerId;
  const [copied, setCopied] = useState(false);

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
    <div
      className="flex min-h-screen flex-col page-container"
      style={{
        backgroundImage: 'linear-gradient(rgba(15,23,42,0.65), rgba(15,23,42,0.65)), url("/images/timeline-bg.webp")',
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "100vh",
      }}
    >
      <header className="mx-auto w-full max-w-[1100px]">
        <h1 className="text-xl font-bold text-white">{roomState.name || "Party Timeliners"}</h1>
        <div className="mt-3">
          <button
            type="button"
            onClick={copyInviteLink}
            className="rounded-[10px] border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-all duration-200 ease hover:bg-violet-100"
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
        <div className="rounded-2xl bg-white p-8 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Players ({roomState.players.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {roomState.players.map((p) => (
              <li
                key={p.playerId}
                className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2"
              >
                <span className="font-medium text-zinc-900">
                  {p.nickname}
                  {p.playerId === playerId && (
                    <span className="ml-2 text-xs text-zinc-500">(you)</span>
                  )}
                </span>
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
              className="mt-8 w-full rounded-[10px] bg-violet-600 px-5 py-3 font-semibold text-white shadow-sm transition-all duration-200 ease hover:bg-violet-700 hover:shadow-md"
            >
              Start game
            </button>
          )}

          {!isHost && (
            <p className="mt-4 text-sm text-slate-300">Waiting for the host to start the game…</p>
          )}
        </div>
      </main>
    </div>
  );
}
