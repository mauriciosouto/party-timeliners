/** Base URL for the backend REST API. Used by all fetch calls to the backend. */
export const API_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:3001";

/** Same as API_BASE but without trailing slash. Use with paths: getApiUrl() + "/api/rooms" */
export function getApiUrl(): string {
  return API_BASE.replace(/\/$/, "");
}

/**
 * WebSocket URL for the room hub. Uses NEXT_PUBLIC_WS_URL in production.
 * When not set, derives from current page (wss on https) or defaults to ws://localhost:3001.
 */
export function getWsUrl(): string {
  const envWs = typeof process !== "undefined" && process.env?.NEXT_PUBLIC_WS_URL;
  if (envWs) {
    const base = envWs.replace(/\/$/, "");
    return base.endsWith("/ws") ? base : `${base}/ws`;
  }
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.hostname}:3001/ws`;
  }
  return "ws://localhost:3001/ws";
}
