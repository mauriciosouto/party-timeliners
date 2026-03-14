"use client";

import { useEffect, useRef, useState } from "react";
import { getWsUrl } from "@/lib/api";
import type { RoomState } from "@/src/services/roomApi";

type WsMessage =
  | { type: "join_ack"; playerId: string; roomState: RoomState }
  | { type: "join_error"; code: string; message: string }
  | { type: "room_state"; roomState: RoomState }
  | { type: "place_result"; correct: boolean; gameEnded?: boolean; score: number; timeline: RoomState["timeline"]; nextEvent?: ApiEvent | null; nextTurnPlayerId?: string | null; currentTurnStartedAt?: string | null; nextDeckSequence?: number }
  | { type: "place_error"; code: string; message: string }
  | { type: "start_error"; code: string; message: string }
  | { type: "rematch_error"; code: string; message: string }
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
  const [roomError, setRoomError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeResult, setPlaceResult] = useState<{
    correct: boolean;
    gameEnded?: boolean;
    score: number;
    nextTurnPlayerId?: string | null;
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
          if (msg.type === "room_state") {
            console.log("[useRoomSocket] room_state", {
              status: msg.roomState.status,
              currentTurnPlayerId: msg.roomState.currentTurnPlayerId,
              timelineLength: msg.roomState.timeline.length,
            });
          } else if (msg.type === "place_result") {
            console.log("[useRoomSocket] place_result", {
              correct: msg.correct,
              gameEnded: msg.gameEnded,
              nextTurnPlayerId: msg.nextTurnPlayerId,
              score: msg.score,
              timelineLength: msg.timeline?.length,
            });
          } else if (msg.type === "place_error") {
            console.log("[useRoomSocket] place_error", msg.message);
          }
          if (msg.type === "join_ack") {
            setRoomState(msg.roomState);
            setWsReady(true);
          } else if (msg.type === "room_state") {
            setRoomState(msg.roomState);
            setRoomError(null);
            setPlaceError(null);
          } else if (msg.type === "start_error" || msg.type === "rematch_error") {
            setRoomError(msg.message);
          } else if (msg.type === "place_error") {
            setPlaceError(msg.message);
          } else if (msg.type === "place_result") {
            setRoomState((prev) => {
              if (!prev) return null;
              const next: RoomState = {
                ...prev,
                timeline: [...msg.timeline].sort((a, b) => a.position - b.position),
              };
              if (msg.nextTurnPlayerId !== undefined) {
                next.currentTurnPlayerId = msg.nextTurnPlayerId ?? null;
              }
              if (msg.currentTurnStartedAt !== undefined) {
                next.currentTurnStartedAt = msg.currentTurnStartedAt ?? null;
              }
              if (msg.nextDeckSequence !== undefined) {
                next.nextDeckSequence = msg.nextDeckSequence;
              }
              if (playerId != null && msg.score !== undefined) {
                next.scores = { ...prev.scores, [playerId]: msg.score };
              }
              return next;
            });
            setPlaceError(null);
            setPlaceResult({
              correct: msg.correct,
              gameEnded: msg.gameEnded,
              score: msg.score,
              nextTurnPlayerId: msg.nextTurnPlayerId,
            });
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
  }, [roomId, nickname]); // intentionally not including playerId so reconnect reuses it

  const sendStartGame = () => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "start_game" }));
    }
  };

  const sendPlaceEvent = (eventId: string, position: number) => {
    console.log("[useRoomSocket] sendPlaceEvent", { eventId, position, readyState: wsRef.current?.readyState });
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({ type: "place_event", eventId, position }),
      );
    } else {
      console.warn("[useRoomSocket] sendPlaceEvent skipped: WebSocket not open");
    }
  };

  const sendTurnTimeout = () => {
    console.log("[useRoomSocket] sendTurnTimeout", { readyState: wsRef.current?.readyState });
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "turn_timeout" }));
    } else {
      console.warn("[useRoomSocket] sendTurnTimeout skipped: WebSocket not open");
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

  const clearPlaceResult = () => setPlaceResult(null);
  const clearRoomError = () => setRoomError(null);
  const clearPlaceError = () => setPlaceError(null);

  return {
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
  };
}
