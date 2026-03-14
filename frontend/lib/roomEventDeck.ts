import { getGlobalEvents, type Event } from "@/lib/eventPool";

const INITIAL_DECK_SIZE = 200;
const REFILL_THRESHOLD = 50;
const TARGET_DECK_SIZE = 200;

const roomDecks = new Map<string, Event[]>();

function pickRandomEvents(
  pool: Event[],
  count: number,
  excludeIds: Set<string>,
): Event[] {
  if (count <= 0 || pool.length === 0) return [];

  const candidates = pool.filter((e) => !excludeIds.has(e.id));
  if (candidates.length === 0) return [];

  // Shuffle using Fisher-Yates.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, count);
}

export async function createRoomDeck(roomId: string): Promise<void> {
  const globalPool = await getGlobalEvents();
  const excludeIds = new Set<string>();
  const deck = pickRandomEvents(globalPool, INITIAL_DECK_SIZE, excludeIds);
  roomDecks.set(roomId, deck);
}

async function refillRoomDeck(roomId: string, deck: Event[]): Promise<void> {
  const globalPool = await getGlobalEvents();
  const excludeIds = new Set(deck.map((e) => e.id));
  const missing = TARGET_DECK_SIZE - deck.length;
  if (missing <= 0) return;

  const extra = pickRandomEvents(globalPool, missing, excludeIds);
  deck.push(...extra);
}

export async function getNextRoomEvent(
  roomId: string,
): Promise<Event | null> {
  if (!roomDecks.has(roomId)) {
    await createRoomDeck(roomId);
  }

  const deck = roomDecks.get(roomId)!;

  if (deck.length === 0) {
    await refillRoomDeck(roomId, deck);
  }

  const event = deck.shift() ?? null;

  if (event && deck.length < REFILL_THRESHOLD) {
    await refillRoomDeck(roomId, deck);
  }

  return event;
}

