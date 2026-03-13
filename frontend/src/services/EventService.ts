import type { TimelineEvent } from "@/lib/types";
import { EVENT_POOL } from "@/lib/mockEvents";

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

async function fetchNextFromApi(
  roomId: string = DEFAULT_ROOM_ID,
): Promise<TimelineEvent | null> {
  try {
    const res = await fetch(`/api/events?roomId=${encodeURIComponent(roomId)}`);
    if (!res.ok) {
      console.warn(
        "[EventService] /api/events returned non-OK status:",
        res.status,
      );
      return null;
    }

    const data = (await res.json()) as { event?: ApiEvent };
    const ev = data.event;
    if (!ev) {
      console.warn("[EventService] /api/events response missing event field");
      return null;
    }

    const mapped: TimelineEvent = {
      id: ev.id,
      title: ev.title,
      year: ev.year,
      // Use displayTitle as description so the card shows "Title (Type)".
      description: ev.displayTitle,
      image: ev.image,
      wikipediaUrl: ev.wikipediaUrl,
    };

    return mapped;
  } catch (error) {
    console.warn("[EventService] Failed to fetch from /api/events:", error);
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

export async function getNextEvent(): Promise<TimelineEvent | null> {
  // Primary source: backend API backed by global event pool + room decks.
  const fromApi = await fetchNextFromApi();
  if (fromApi) return fromApi;

  // Fallback: local mock dataset to keep the prototype playable.
  const fallback = getNextFromMock();
  if (fallback) {
    console.log("[EventService] using mock fallback event:", fallback);
    return fallback;
  }

  return null;
}

