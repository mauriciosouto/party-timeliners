"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { joinRoom, getRoomState, type RoomState } from "@/src/services/roomApi";
import { JoinForm } from "@/components/JoinForm";
import { Lobby } from "@/components/Lobby";
import { RoomGameBoard } from "@/components/RoomGameBoard";
import { useRoomSocket } from "@/src/hooks/useRoomSocket";

const STORAGE_KEY = (roomId: string) => `room_${roomId}`;

function getStoredPlayer(roomId: string): { playerId: string; nickname: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(roomId));
    if (!raw) return null;
    const data = JSON.parse(raw) as { playerId: string; nickname: string };
    return data?.playerId && data?.nickname ? data : null;
  } catch {
    return null;
  }
}

function setStoredPlayer(
  roomId: string,
  playerId: string,
  nickname: string,
): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY(roomId),
      JSON.stringify({ playerId, nickname }),
    );
  } catch {
    // ignore
  }
}

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = (params?.roomId as string) ?? "";

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    const fromQuery = searchParams?.get("playerId");
    const fromStorage = roomId ? getStoredPlayer(roomId) : null;
    if (fromQuery) {
      setPlayerId(fromQuery);
      setNickname(fromStorage?.nickname ?? "Player");
    } else if (fromStorage) {
      setPlayerId(fromStorage.playerId);
      setNickname(fromStorage.nickname);
    }
    setInitialLoad(false);
  }, [roomId, searchParams]);

  const handleJoined = useCallback(
    (joinedPlayerId: string, joinedNickname: string) => {
      setPlayerId(joinedPlayerId);
      setNickname(joinedNickname);
      if (roomId) setStoredPlayer(roomId, joinedPlayerId, joinedNickname);
    },
    [roomId],
  );

  const {
    roomState,
    wsReady,
    placeResult,
    placeError,
    clearPlaceError,
    roomError,
    clearRoomError,
    sendStartGame,
    sendPlaceEvent,
    sendTurnTimeout,
    sendRematch,
    sendEndGame,
    clearPlaceResult,
  } = useRoomSocket(roomId || null, playerId, nickname);

  if (!roomId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-zinc-500">Invalid room</p>
      </div>
    );
  }

  if (initialLoad) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (!playerId) {
    return (
      <JoinForm
        roomId={roomId}
        onJoined={handleJoined}
      />
    );
  }

  const state = roomState ?? null;

  if (state?.status === "lobby") {
    return (
      <Lobby
        roomId={roomId}
        playerId={playerId}
        roomState={state}
        wsReady={wsReady}
        roomError={roomError}
        onClearRoomError={clearRoomError}
        onStartGame={sendStartGame}
      />
    );
  }

  if (state?.status === "playing" || state?.status === "ended") {
    return (
      <RoomGameBoard
        roomId={roomId}
        playerId={playerId}
        roomState={state}
        wsReady={wsReady}
        placeResult={placeResult}
        placeError={placeError}
        onClearPlaceError={clearPlaceError}
        roomError={roomError}
        onClearRoomError={clearRoomError}
        onPlaceEvent={sendPlaceEvent}
        onTurnTimeout={sendTurnTimeout}
        onRematch={sendRematch}
        onEndGame={sendEndGame}
        onClearPlaceResult={clearPlaceResult}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      {wsReady ? (
        <p className="text-zinc-500">Connecting…</p>
      ) : (
        <p className="text-zinc-500">Loading room…</p>
      )}
    </div>
  );
}
