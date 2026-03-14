"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom } from "@/src/services/roomApi";

const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_POINTS_TO_WIN = 2;

export default function Home() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");
  const [maxEvents, setMaxEvents] = useState(DEFAULT_MAX_EVENTS);
  const [pointsToWin, setPointsToWin] = useState(DEFAULT_POINTS_TO_WIN);
  const [turnTimeMinutes, setTurnTimeMinutes] = useState<number | "">(1);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const turnTimeLimitSeconds =
        turnTimeMinutes === "" || turnTimeMinutes === null
          ? undefined
          : turnTimeMinutes <= 0
            ? null
            : Math.round(Number(turnTimeMinutes) * 60);
      const { roomId, playerId } = await createRoom(
        nickname.trim() || "Player",
        roomName.trim() || undefined,
        {
          maxTimelineSize: maxEvents,
          pointsToWin,
          turnTimeLimitSeconds,
        },
      );
      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          `room_${roomId}`,
          JSON.stringify({ playerId, nickname: nickname.trim() || "Player" }),
        );
      }
      router.push(`/room/${roomId}?playerId=${encodeURIComponent(playerId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
      setLoading(false);
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    let id = joinRoomId.trim();
    if (!id) return;
    try {
      const url = new URL(id);
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[segments.length - 1]) id = segments[segments.length - 1]!;
    } catch {
      // not a URL, use as-is
    }
    setError(null);
    router.push(`/room/${id}`);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <h1 className="text-2xl font-bold text-zinc-900">Party Timeliners</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Place events on the timeline. Multiplayer by link.
      </p>

      <div className="mt-10 flex w-full max-w-md flex-col gap-8">
        <div className="rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-200/60">
          <h2 className="text-lg font-semibold text-zinc-900">Create room</h2>
          <form onSubmit={handleCreateRoom} className="mt-4 space-y-3">
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Your nickname"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Room name (optional)"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                Max events
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={maxEvents}
                  onChange={(e) => setMaxEvents(Number(e.target.value) || DEFAULT_MAX_EVENTS)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                Points to win
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={pointsToWin}
                  onChange={(e) => setPointsToWin(Number(e.target.value) || DEFAULT_POINTS_TO_WIN)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                Turno (min)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="Sin límite"
                  value={turnTimeMinutes}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTurnTimeMinutes(v === "" ? "" : Number(v));
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <span className="mt-0.5 text-[11px] text-zinc-400">0 o vacío = sin límite</span>
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create room"}
            </button>
          </form>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-200/60">
          <h2 className="text-lg font-semibold text-zinc-900">Join room</h2>
          <form onSubmit={handleJoinRoom} className="mt-4 space-y-3">
            <input
              type="text"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              placeholder="Paste room ID or link"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button
              type="submit"
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Join
            </button>
          </form>
        </div>

        {error && (
          <p className="text-center text-sm text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}
