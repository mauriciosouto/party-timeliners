"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { JoinForm } from "@/components/JoinForm";
import { Lobby } from "@/components/Lobby";
import { RoomGameBoard } from "@/components/RoomGameBoard";
import { useRoomSocket } from "@/src/hooks/useRoomSocket";
import { getStoredPlayer, setStoredPlayer, clearRoomFromStorage } from "@/lib/roomStorage";
import { playStartGameSound } from "@/src/utils/sound";

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
    const run = () => {
      if (fromQuery) {
        setPlayerId(fromQuery);
        setNickname(fromStorage?.nickname ?? "Player");
      } else if (fromStorage) {
        setPlayerId(fromStorage.playerId);
        setNickname(fromStorage.nickname);
      }
      setInitialLoad(false);
    };
    queueMicrotask(run);
  }, [roomId, searchParams]);

  const handleJoined = useCallback(
    (joinedPlayerId: string, joinedNickname: string, avatar?: string) => {
      setPlayerId(joinedPlayerId);
      setNickname(joinedNickname);
      if (roomId) setStoredPlayer(roomId, joinedPlayerId, joinedNickname, avatar);
    },
    [roomId],
  );

  const router = useRouter();
  const {
    roomState,
    wsReady,
    roomClosed,
    leftRoom,
    playerLeftNotification,
    clearPlayerLeftNotification,
    yourTurnToast,
    clearYourTurnToast,
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
    sendLeaveRoom,
    clearPlaceResult,
  } = useRoomSocket(roomId || null, playerId, nickname);

  // When the room has ended, clear stored credentials so "rejoin" is not offered on home.
  useEffect(() => {
    if (roomId && roomState?.status === "ended") {
      clearRoomFromStorage(roomId);
    }
  }, [roomId, roomState?.status]);

  // When host closed the room, clear storage and redirect everyone to home.
  useEffect(() => {
    if (roomClosed && roomId) {
      clearRoomFromStorage(roomId);
      router.push("/");
    }
  }, [roomClosed, roomId, router]);

  // When this player left the room (leave_ack), clear storage and redirect.
  useEffect(() => {
    if (leftRoom && roomId) {
      clearRoomFromStorage(roomId);
      router.push("/");
    }
  }, [leftRoom, roomId, router]);

  // Auto-dismiss "player left" toast after 5s.
  useEffect(() => {
    if (!playerLeftNotification) return;
    const t = setTimeout(clearPlayerLeftNotification, 5000);
    return () => clearTimeout(t);
  }, [playerLeftNotification, clearPlayerLeftNotification]);

  // Auto-dismiss "Your turn" toast after 2.5s.
  useEffect(() => {
    if (!yourTurnToast) return;
    const t = setTimeout(clearYourTurnToast, 2500);
    return () => clearTimeout(t);
  }, [yourTurnToast, clearYourTurnToast]);

  const prevStatusRef = useRef<string | null>(null);
  const [gameJustStarted, setGameJustStarted] = useState(false);

  useEffect(() => {
    const status = roomState?.status ?? null;
    if (prevStatusRef.current === "lobby" && status === "playing") {
      playStartGameSound();
      queueMicrotask(() => setGameJustStarted(true));
      const t = setTimeout(() => setGameJustStarted(false), 500);
      prevStatusRef.current = status;
      return () => clearTimeout(t);
    }
    prevStatusRef.current = status;
  }, [roomState?.status]);

  if (!roomId) {
    return (
      <div className="hero-background flex min-h-screen items-center justify-center p-6">
        <p className="text-zinc-500">Invalid room</p>
      </div>
    );
  }

  if (initialLoad) {
    return (
      <div className="hero-background flex min-h-screen items-center justify-center p-6">
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
        onLeaveRoom={sendLeaveRoom}
        onCloseRoom={sendCloseRoom}
      />
    );
  }

  if (state?.status === "playing" || state?.status === "ended") {
    return (
      <>
        {gameJustStarted && (
          <div
            className="game-start-flash fixed inset-0 z-[9998] pointer-events-none"
            aria-hidden
          />
        )}
        {yourTurnToast && (
          <div
            role="status"
            aria-live="polite"
            className="your-turn-toast"
          >
            Your turn
          </div>
        )}
        {playerLeftNotification && (
          <div
            role="status"
            className="fixed left-1/2 top-6 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-lg"
          >
            <span>{playerLeftNotification} left the game</span>
            <button
              type="button"
              onClick={clearPlayerLeftNotification}
              className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
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
          onCloseRoom={sendCloseRoom}
          onLeaveRoom={sendLeaveRoom}
          onClearPlaceResult={clearPlaceResult}
        />
      </>
    );
  }

  return (
    <div className="hero-background flex min-h-screen items-center justify-center p-6">
      {wsReady ? (
        <p className="text-zinc-500">Connecting…</p>
      ) : (
        <p className="text-zinc-500">Loading room…</p>
      )}
    </div>
  );
}
