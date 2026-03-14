import type { TimelineEvent } from "@/lib/types";
import { EVENT_POOL } from "@/lib/mockEvents";
import { getApiUrl } from "@/lib/api";

const DEFAULT_ROOM_ID = "local-singleplayer";

type ApiEvent = {
  id: string;
  title: string;
  type: string;
  displayTitle: string;
  year: number;
  image?: string;
  wikipediaUrl?: string;
};

function mapApiEventToTimeline(ev: ApiEvent): TimelineEvent {
  return {
    id: ev.id,
    title: ev.title,
    year: ev.year,
    description: ev.displayTitle,
    image: ev.image,
    wikipediaUrl: ev.wikipediaUrl,
  };
}

/** Prefer backend pool (DB); then Next.js API (local JSON); then mock. */
async function fetchNextFromBackend(): Promise<TimelineEvent | null> {
  try {
    const res = await fetch(`${getApiUrl()}/api/events/next`);
    if (!res.ok) return null;
    const data = (await res.json()) as { event?: ApiEvent };
    const ev = data.event;
    return ev ? mapApiEventToTimeline(ev) : null;
  } catch {
    return null;
  }
}

async function fetchNextFromNextApi(
  roomId: string = DEFAULT_ROOM_ID,
): Promise<TimelineEvent | null> {
  try {
    const res = await fetch(`/api/events?roomId=${encodeURIComponent(roomId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { event?: ApiEvent };
    const ev = data.event;
    return ev ? mapApiEventToTimeline(ev) : null;
  } catch {
    return null;
  }
}

let mockIndex = 0;

function getNextFromMock(): TimelineEvent | null {
  if (mockIndex >= EVENT_POOL.length) return null;
  const ev = EVENT_POOL[mockIndex];
  mockIndex += 1;
  return ev;
}

/**
 * Fetches the next event for the player to place.
 * Uses backend DB pool first, then Next.js API (local pool), then mock.
 * @param roomId - Used only for Next.js API fallback (room deck). Ignored when using backend.
 */
export async function getNextEvent(
  roomId: string = DEFAULT_ROOM_ID,
): Promise<TimelineEvent | null> {
  const fromBackend = await fetchNextFromBackend();
  if (fromBackend) return fromBackend;

  const fromNextApi = await fetchNextFromNextApi(roomId);
  if (fromNextApi) return fromNextApi;

  const fallback = getNextFromMock();
  if (fallback) {
    console.log("[EventService] using mock fallback event");
    return fallback;
  }

  return null;
}

