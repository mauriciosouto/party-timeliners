"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { joinRoom, getRoomState, type RoomState } from "@/src/services/roomApi";
import { JoinForm } from "@/components/JoinForm";
import { Lobby } from "@/components/Lobby";
import { RoomGameBoard } from "@/components/RoomGameBoard";
import { useRoomSocket } from "@/src/hooks/useRoomSocket";
import { getStoredPlayer, setStoredPlayer, clearRoomFromStorage } from "@/lib/roomStorage";

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

  const router = useRouter();
  const {
    roomState,
    wsReady,
    roomClosed,
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
    sendCloseRoom,
    clearPlaceResult,
  } = useRoomSocket(roomId || null, playerId, nickname);

  // When the room has ended, clear stored credentials so "rejoin" is not offered on home.
  useEffect(() => {
    if (roomId && roomState?.status === "ended") {
      clearRoomFromStorage(roomId);
    }
  }, [roomId, roomState?.status]);

  // When host closed the room, redirect everyone to home.
  useEffect(() => {
    if (roomClosed) router.push("/");
  }, [roomClosed, router]);

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
        onCloseRoom={() => {
          sendCloseRoom();
          router.push("/");
        }}
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
