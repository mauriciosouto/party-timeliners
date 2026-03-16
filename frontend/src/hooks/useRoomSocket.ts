"use client";

import { useEffect, useRef, useState } from "react";
import { getWsUrl } from "@/lib/api";
import type { RoomState } from "@/src/services/roomApi";

type WsMessage =
  | { type: "join_ack"; playerId: string; roomState: RoomState; room?: RoomState }
  | { type: "join_error"; code: string; message: string }
  | { type: "state_update"; room: RoomState }
  | { type: "room_state"; roomState: RoomState }
  | { type: "place_result"; correct: boolean; gameEnded?: boolean; score: number; timeline?: RoomState["timeline"]; correctPosition?: number; nextEvent?: ApiEvent | null; nextTurnPlayerId?: string | null; currentTurnStartedAt?: string | null; nextDeckSequence?: number }
  | { type: "place_error"; code: string; message: string }
  | { type: "start_error"; code: string; message: string }
  | { type: "rematch_error"; code: string; message: string }
  | { type: "room_closed" }
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
  const [roomError, setRoomError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeResult, setPlaceResult] = useState<{
    correct: boolean;
    gameEnded?: boolean;
    score: number;
    nextTurnPlayerId?: string | null;
    correctPosition?: number;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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
            setRoomState(state);
            setWsReady(true);
          } else if (msg.type === "state_update" || msg.type === "room_state") {
            const state = msg.type === "state_update" ? msg.room : msg.roomState;
            setRoomState(state);
            setRoomError(null);
            setPlaceError(null);
          } else if (msg.type === "start_error" || msg.type === "rematch_error") {
            setRoomError(msg.message);
          } else if (msg.type === "place_error") {
            setPlaceError(msg.message);
          } else if (msg.type === "place_result") {
            setPlaceError(null);
            setPlaceResult({
              correct: msg.correct,
              gameEnded: msg.gameEnded,
              score: msg.score,
              nextTurnPlayerId: msg.nextTurnPlayerId,
              correctPosition: msg.correctPosition,
            });
            if (msg.timeline && msg.timeline.length > 0) {
              setRoomState((prev) =>
                prev ? { ...prev, timeline: msg.timeline! } : null,
              );
            }
          } else if (msg.type === "room_closed") {
            setRoomClosed(true);
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
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "start_game" }));
    }
  };

  const sendPlaceEvent = (eventId: string, position: number) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({ type: "place_event", eventId, position }),
      );
    }
  };

  const sendTurnTimeout = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "turn_timeout" }));
    }
  };

  const sendRematch = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "rematch" }));
    }
  };

  const sendEndGame = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "end_game" }));
    }
  };

  const sendCloseRoom = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "close_room" }));
    }
  };

  const clearPlaceResult = () => setPlaceResult(null);
  const clearRoomError = () => setRoomError(null);
  const clearPlaceError = () => setPlaceError(null);

  return {
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
  };
}
