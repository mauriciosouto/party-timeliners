"use client";

import { useEffect, useRef, useState } from "react";
import { getWsUrl } from "@/lib/api";
import type { RoomState } from "@/src/services/roomApi";
import { playYourTurnSound } from "@/src/utils/sound";

/** Ensure timeline is always ordered by position (for placer and non-active players). */
function sortTimelineByPosition<T extends { position: number }>(timeline: T[]): T[] {
  return timeline.length <= 1 ? timeline : [...timeline].sort((a, b) => a.position - b.position);
}

type WsMessage =
  | { type: "join_ack"; playerId: string; roomState: RoomState; room?: RoomState }
  | { type: "join_error"; code: string; message: string }
  | { type: "state_update"; room: RoomState }
  | { type: "room_state"; roomState: RoomState }
  | {
      type: "place_result";
      correct: boolean;
      gameEnded?: boolean;
      score: number;
      streak?: number;
      timeline?: RoomState["timeline"];
      correctPosition?: number;
      nextEvent?: ApiEvent | null;
      nextTurnPlayerId?: string | null;
      currentTurnStartedAt?: string | null;
      nextDeckSequence?: number;
      lastPlacedEvent?: RoomState["lastPlacedEvent"];
    }
  | { type: "place_error"; code: string; message: string }
  | { type: "game_starting" }
  | { type: "game_start_failed"; message: string }
  | { type: "start_error"; code: string; message: string }
  | { type: "rematch_starting" }
  | { type: "rematch_failed"; message: string }
  | { type: "rematch_error"; code: string; message: string }
  | { type: "close_room_starting" }
  | { type: "close_room_failed"; message: string }
  | { type: "leave_ack" }
  | { type: "leave_error"; message: string }
  | { type: "player_left"; nickname: string }
  | { type: "room_closed" }
  | { type: "close_room_error"; message: string }
  | { type: "pong" };

type ApiEvent = {
  id: string;
  title: string;
  year: number;
  displayTitle: string;
  image?: string;
  wikipediaUrl?: string;
};

export function useRoomSocket(
  roomId: string | null,
  playerId: string | null,
  nickname: string,
) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const [leftRoom, setLeftRoom] = useState(false);
  const [playerLeftNotification, setPlayerLeftNotification] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeResult, setPlaceResult] = useState<{
    correct: boolean;
    gameEnded?: boolean;
    score: number;
    streak?: number;
    nextTurnPlayerId?: string | null;
    correctPosition?: number;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<string | null>(playerId);
  playerIdRef.current = playerId;
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const prevTurnPlayerIdRef = useRef<string | null>(null);
  const [yourTurnToast, setYourTurnToast] = useState(false);
  const [gameStarting, setGameStarting] = useState(false);
  const [rematchStarting, setRematchStarting] = useState(false);
  const [closeRoomStarting, setCloseRoomStarting] = useState(false);
  const [placingPending, setPlacingPending] = useState<{
    eventId: string;
    position: number;
  } | null>(null);

  useEffect(() => {
    if (!placingPending) return;
    const t = setTimeout(() => setPlacingPending(null), 25_000);
    return () => clearTimeout(t);
  }, [placingPending]);

  useEffect(() => {
    if (!roomState || roomState.status !== "playing" || !playerId) {
      prevTurnPlayerIdRef.current = null;
      return;
    }
    const current = roomState.currentTurnPlayerId ?? null;
    if (
      current === playerId &&
      prevTurnPlayerIdRef.current !== null &&
      prevTurnPlayerIdRef.current !== playerId
    ) {
      playYourTurnSound();
      setYourTurnToast(true);
    }
    prevTurnPlayerIdRef.current = current;
  }, [roomState, playerId]);

  useEffect(() => {
    if (!roomId || !nickname) return;

    mountedRef.current = true;
    const url = getWsUrl();

    function connect() {
      if (!mountedRef.current) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        ws.send(
          JSON.stringify({
            type: "join_room",
            roomId,
            playerId: playerId ?? undefined,
            nickname,
          }),
        );
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          if (msg.type === "join_ack") {
            const state = msg.room ?? msg.roomState;
            setRoomState({
              ...state,
              timeline: sortTimelineByPosition(state.timeline ?? []),
            });
            setWsReady(true);
            setGameStarting(false);
            setRematchStarting(false);
            setCloseRoomStarting(false);
            setPlacingPending(null);
          } else if (msg.type === "state_update" || msg.type === "room_state") {
            const state = msg.type === "state_update" ? msg.room : msg.roomState;
            setRoomState({
              ...state,
              timeline: sortTimelineByPosition(state.timeline ?? []),
            });
            setRoomError(null);
            setPlaceError(null);
            setPlacingPending(null);
            if (state.status === "playing" || state.status === "ended") {
              setGameStarting(false);
            }
            if (state.status === "lobby") {
              setRematchStarting(false);
            }
          } else if (msg.type === "game_starting") {
            setGameStarting(true);
            setRoomError(null);
          } else if (msg.type === "game_start_failed") {
            setGameStarting(false);
            setRoomError(msg.message);
          } else if (msg.type === "rematch_starting") {
            setRematchStarting(true);
            setRoomError(null);
          } else if (msg.type === "rematch_failed") {
            setRematchStarting(false);
            setRoomError(msg.message);
          } else if (msg.type === "close_room_starting") {
            setCloseRoomStarting(true);
            setRoomError(null);
          } else if (msg.type === "close_room_failed") {
            setCloseRoomStarting(false);
            setRoomError(msg.message);
          } else if (msg.type === "start_error") {
            setGameStarting(false);
            setRoomError(msg.message);
          } else if (msg.type === "rematch_error") {
            setRematchStarting(false);
            setRoomError(msg.message);
          } else if (msg.type === "place_error") {
            setPlacingPending(null);
            setPlaceError(msg.message);
          } else if (msg.type === "place_result") {
            setPlaceError(null);
            setPlaceResult({
              correct: msg.correct,
              gameEnded: msg.gameEnded,
              score: msg.score,
              streak: msg.streak,
              nextTurnPlayerId: msg.nextTurnPlayerId,
              correctPosition: msg.correctPosition,
            });
            const pid = playerIdRef.current;
            if (pid != null && msg.streak !== undefined) {
              setRoomState((prev) =>
                prev
                  ? {
                      ...prev,
                      players: prev.players.map((p) =>
                        p.playerId === pid ? { ...p, streak: msg.streak! } : p,
                      ),
                      timeline:
                        msg.timeline && msg.timeline.length > 0
                          ? sortTimelineByPosition(msg.timeline)
                          : prev.timeline,
                      lastPlacedEvent: msg.lastPlacedEvent ?? prev.lastPlacedEvent ?? null,
                      currentTurnStartedAt:
                        msg.currentTurnStartedAt ?? prev.currentTurnStartedAt ?? null,
                    }
                  : null,
              );
            } else if (msg.timeline && msg.timeline.length > 0) {
              setRoomState((prev) =>
                prev
                  ? {
                      ...prev,
                      timeline: sortTimelineByPosition(msg.timeline!),
                      lastPlacedEvent: msg.lastPlacedEvent ?? prev.lastPlacedEvent ?? null,
                      currentTurnStartedAt:
                        msg.currentTurnStartedAt ?? prev.currentTurnStartedAt ?? null,
                    }
                  : null,
              );
            }
          } else if (msg.type === "room_closed") {
            setRematchStarting(false);
            setCloseRoomStarting(false);
            setRoomClosed(true);
          } else if (msg.type === "leave_ack") {
            setLeftRoom(true);
          } else if (msg.type === "leave_error" || msg.type === "close_room_error") {
            setCloseRoomStarting(false);
            setRoomError(msg.message);
          } else if (msg.type === "player_left") {
            setPlayerLeftNotification(msg.nickname);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setWsReady(false);
        wsRef.current = null;
        if (!mountedRef.current) return;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, 1500);
      };

      ws.onerror = () => {
        setWsReady(false);
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playerId omitted so reconnect reuses it
  }, [roomId, nickname]);

  const sendStartGame = () => {
    setGameStarting(true);
    setRoomError(null);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "start_game" }));
    } else {
      setGameStarting(false);
      setRoomError("Not connected. Try again.");
    }
  };

  const sendPlaceEvent = (eventId: string, position: number) => {
    setPlacingPending({ eventId, position });
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({ type: "place_event", eventId, position }),
      );
    } else {
      setPlacingPending(null);
      setPlaceError("Not connected. Try again.");
    }
  };

  const sendTurnTimeout = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "turn_timeout" }));
    }
  };

  const sendRematch = () => {
    setRematchStarting(true);
    setRoomError(null);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "rematch" }));
    } else {
      setRematchStarting(false);
      setRoomError("Not connected. Try again.");
    }
  };

  const sendEndGame = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "end_game" }));
    }
  };

  const sendCloseRoom = () => {
    setCloseRoomStarting(true);
    setRoomError(null);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "close_room" }));
    } else {
      setCloseRoomStarting(false);
      setRoomError("Not connected. Try again.");
    }
  };

  const sendLeaveRoom = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "leave_room" }));
    }
  };

  const clearPlaceResult = () => setPlaceResult(null);
  const clearRoomError = () => setRoomError(null);
  const clearPlaceError = () => setPlaceError(null);
  const clearPlayerLeftNotification = () => setPlayerLeftNotification(null);
  const clearYourTurnToast = () => setYourTurnToast(false);

  return {
    roomState,
    wsReady,
    roomClosed,
    leftRoom,
    playerLeftNotification,
    yourTurnToast,
    clearYourTurnToast,
    clearPlayerLeftNotification,
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
    gameStarting,
    rematchStarting,
    closeRoomStarting,
    placingPending,
  };
}
