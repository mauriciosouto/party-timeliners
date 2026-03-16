/** Base URL for the backend REST API. Used by all fetch calls to the backend. */
export const API_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:3001";

/** Same as API_BASE but without trailing slash. Use with paths: getApiUrl() + "/api/rooms" */
export function getApiUrl(): string {
  return API_BASE.replace(/\/$/, "");
}

export function getWsUrl(): string {
  // In Next.js, NEXT_PUBLIC_* vars are replaced at build time, so this is safe
  const envWs = process.env.NEXT_PUBLIC_WS_URL;
  if (envWs) {
    const base = envWs.replace(/\/$/, "");
    return base.endsWith("/ws") ? base : `${base}/ws`;
  }
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname;
    // For local dev without env vars, talk to backend on :3001.
    // In production (Vercel, etc.) we don't append a port and expect NEXT_PUBLIC_WS_URL.
    const port =
      host === "localhost" || host === "127.0.0.1" ? ":3001" : "";
    return `${protocol}://${host}${port}/ws`;
  }
  return "ws://localhost:3001/ws";
}
