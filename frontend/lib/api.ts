const API_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:3001";

export function getApiUrl(): string {
  return API_URL.replace(/\/$/, "");
}

export function getWsUrl(): string {
  const base = getApiUrl();
  return base.replace(/^http/, "ws") + "/ws";
}
