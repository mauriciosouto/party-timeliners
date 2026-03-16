"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createRoom, getRoomState } from "@/src/services/roomApi";
import { getLastRoom, clearRoomFromStorage, setStoredPlayer } from "@/lib/roomStorage";

const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_POINTS_TO_WIN = 2;

type PreviousRoom = {
  roomId: string;
  playerId: string;
  nickname: string;
};

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
  const [previousRoom, setPreviousRoom] = useState<PreviousRoom | null>(null);
  const [checkingPrevious, setCheckingPrevious] = useState(true);

  useEffect(() => {
    const last = getLastRoom();
    if (!last) {
      queueMicrotask(() => setCheckingPrevious(false));
      return;
    }
    getRoomState(last.roomId)
      .then((state) => {
        if (!state || state.status === "ended") {
          clearRoomFromStorage(last.roomId);
          setPreviousRoom(null);
        } else {
          setPreviousRoom({ roomId: last.roomId, playerId: last.playerId, nickname: last.nickname });
        }
      })
      .catch(() => {
        clearRoomFromStorage(last.roomId);
        setPreviousRoom(null);
      })
      .finally(() => setCheckingPrevious(false));
  }, []);

  const handleClearPrevious = () => {
    if (previousRoom) {
      clearRoomFromStorage(previousRoom.roomId);
      setPreviousRoom(null);
    }
  };

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
      const nick = nickname.trim() || "Player";
      setStoredPlayer(roomId, playerId, nick);
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
    <div className="hero-background flex min-h-screen flex-col items-center justify-center page-container">
      <h1 className="text-2xl font-bold text-white">Party Timeliners</h1>
      <p className="mt-1 text-sm text-slate-200">
        Place events on the timeline. Multiplayer by link.
      </p>

      <div className="mx-auto mt-12 flex w-full max-w-[1100px] flex-col gap-8">
        {checkingPrevious && (
          <p className="text-center text-sm text-slate-300">Checking previous game…</p>
        )}
        {!checkingPrevious && previousRoom && (
          <div className="w-full max-w-[1100px] rounded-2xl bg-white p-8 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
            <h2 className="text-lg font-semibold text-zinc-900">Previous game</h2>
            <p className="mt-1 text-sm text-zinc-600">
              You&apos;re in the room as <span className="font-medium">{previousRoom.nickname}</span>. The game is still active.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={`/room/${previousRoom.roomId}`}
                className="inline-block rounded-[10px] bg-violet-600 px-[18px] py-2.5 text-center font-semibold text-white shadow-sm transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-violet-700"
              >
                Rejoin
              </Link>
              <button
                type="button"
                onClick={handleClearPrevious}
                className="rounded-[10px] border border-zinc-300 bg-white px-[18px] py-2.5 font-semibold text-zinc-700 transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-zinc-50"
              >
                End previous game
              </button>
            </div>
          </div>
        )}
        <div className="w-full max-w-[1100px] rounded-2xl bg-white p-8 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-zinc-900">Create room</h2>
          <form onSubmit={handleCreateRoom} className="mt-6 space-y-4">
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
                Turn (min)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="No limit"
                  value={turnTimeMinutes}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTurnTimeMinutes(v === "" ? "" : Number(v));
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <span className="mt-0.5 text-[11px] text-zinc-400">0 or empty = no limit</span>
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-[10px] bg-violet-600 px-[18px] py-2.5 font-semibold text-white shadow-sm transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create room"}
            </button>
          </form>
        </div>

        <div className="w-full max-w-[1100px] rounded-2xl bg-white p-8 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-zinc-900">Join a room</h2>
          <form onSubmit={handleJoinRoom} className="mt-6 space-y-4">
            <input
              type="text"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              placeholder="Paste room ID or link"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button
              type="submit"
              className="w-full rounded-[10px] border border-zinc-300 bg-white px-[18px] py-2.5 font-semibold text-zinc-700 transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-zinc-50"
            >
              Join
            </button>
          </form>
        </div>

        {error && (
          <p className="text-center text-sm text-red-300">{error}</p>
        )}
      </div>
    </div>
  );
}
