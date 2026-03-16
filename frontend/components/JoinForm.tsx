"use client";

import { useState, useEffect } from "react";
import { joinRoom, getRoomState } from "@/src/services/roomApi";
import { AvatarPicker } from "@/components/AvatarPicker";
import { getRandomAvatar } from "@/lib/avatars";

type JoinFormProps = {
  roomId: string;
  onJoined: (playerId: string, nickname: string, avatar?: string) => void;
};

export function JoinForm({ roomId, onJoined }: JoinFormProps) {
  const [nickname, setNickname] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
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
      const avatar = selectedAvatar ?? getRandomAvatar();
      const result = await joinRoom(roomId, nickname.trim() || "Player", avatar);
      const nick = result.roomState.players.find((p) => p.playerId === result.playerId)?.nickname ?? nickname;
      onJoined(result.playerId, nick, avatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hero-background flex min-h-screen flex-col items-center justify-center page-container">
      <div className="glass-panel w-full max-w-sm">
        <h1 className="text-xl font-bold text-zinc-900">Join room</h1>
        {roomInfo && (
          <p className="mt-1 text-sm text-zinc-600">
            <span className="font-medium">{roomInfo.name}</span>
            <span className="text-zinc-500"> · Host: {roomInfo.hostNickname}</span>
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
          <div>
            <p className="mb-2 block text-sm font-medium text-zinc-700">Avatar</p>
            <AvatarPicker
              selectedAvatar={selectedAvatar}
              onSelect={setSelectedAvatar}
              aria-label="Choose your avatar"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[10px] bg-violet-600 px-[18px] py-2.5 font-semibold text-white shadow-sm transition-all duration-200 ease hover:-translate-y-px hover:shadow-[0_6px_12px_rgba(0,0,0,0.15)] hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? "Joining…" : "Join"}
          </button>
        </form>
      </div>
    </div>
  );
}
