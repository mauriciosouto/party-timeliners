"use client";

import { useState, useEffect } from "react";
import { joinRoom, getRoomState } from "@/src/services/roomApi";

type JoinFormProps = {
  roomId: string;
  onJoined: (playerId: string, nickname: string) => void;
};

export function JoinForm({ roomId, onJoined }: JoinFormProps) {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [roomInfo, setRoomInfo] = useState<{ name: string; hostNickname: string } | null>(null);

  useEffect(() => {
    if (!roomId) return;
    getRoomState(roomId)
      .then((state) => {
        if (!state) return;
        const host = state.players.find((p) => p.playerId === state.hostPlayerId);
        setRoomInfo({
          name: state.name || "Party Timeliners",
          hostNickname: host?.nickname ?? "Host",
        });
      })
      .catch(() => setRoomInfo(null));
  }, [roomId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await joinRoom(roomId, nickname.trim() || "Player");
      onJoined(result.playerId, result.roomState.players.find((p) => p.playerId === result.playerId)?.nickname ?? nickname);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-200/60">
        <h1 className="text-xl font-bold text-zinc-900">Unirse a la sala</h1>
        {roomInfo && (
          <p className="mt-1 text-sm text-zinc-600">
            <span className="font-medium">{roomInfo.name}</span>
            <span className="text-zinc-500"> · Anfitrión: {roomInfo.hostNickname}</span>
          </p>
        )}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="nickname" className="block text-sm font-medium text-zinc-700">
              Nickname
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Your name"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              autoFocus
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? "Joining…" : "Join"}
          </button>
        </form>
      </div>
    </div>
  );
}
