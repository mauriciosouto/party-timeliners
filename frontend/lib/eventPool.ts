import poolData from "@/data/eventPool.json";

const TARGET_POOL_SIZE = 300;

export type Event = {
  id: string;
  title: string;
  type: string;
  displayTitle: string;
  year: number;
  image?: string;
  wikipediaUrl?: string;
};

type WikidataBinding = {
  event: { value: string };
  eventLabel?: { value: string };
  date?: { value: string };
  image?: { value: string };
  article?: { value: string };
};

const globalPool: Event[] = (poolData as Event[]) ?? [];

export async function ensureGlobalPoolFilled(): Promise<void> {
  // With static JSON ingestion, there is nothing to do here at runtime.
  if (globalPool.length < TARGET_POOL_SIZE) {
    console.warn(
      `[eventPool] Global pool has only ${globalPool.length} events. For multiplayer, use the backend event pool (backend: npm run refresh-events or POST /api/admin/refresh-events).`,
    );
  }
}

export async function getGlobalEvents(): Promise<Event[]> {
  await ensureGlobalPoolFilled();
  return globalPool;
}


