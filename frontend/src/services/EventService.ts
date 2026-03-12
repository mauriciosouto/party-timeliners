import type { TimelineEvent } from "@/lib/types";
import { EVENT_POOL } from "@/lib/mockEvents";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const CURRENT_YEAR = new Date().getUTCFullYear();
const BATCH_SIZE = 100;
const MIN_CACHE_SIZE = 15;
const MIN_REQUEST_INTERVAL_MS = 1000;

type WikidataBinding = {
  event: { value: string };
  eventLabel?: { value: string };
  date?: { value: string };
  image?: { value: string };
  article?: { value: string };
};

let cachedEvents: TimelineEvent[] = [];
const usedEventIds = new Set<string>();
let lastRequestTime = 0;

function parseYearFromWikidataDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/^([+-]?\d+)-/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  if (Number.isNaN(year)) return null;
  return year;
}

function normalizeBindings(bindings: WikidataBinding[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const binding of bindings) {
    const rawId = binding.event.value;
    const id = rawId.split("/").pop() ?? rawId;

    const title = binding.eventLabel?.value?.trim();
    if (!title) {
      // Discard events without a reliable title.
      continue;
    }

    const year = parseYearFromWikidataDate(binding.date?.value);
    if (year == null || year > CURRENT_YEAR) continue;

    const image = binding.image?.value;
    const wikipediaUrl = binding.article?.value;

    events.push({
      id,
      title,
      year,
      description: undefined,
      image,
      wikipediaUrl,
    });
  }

  return events;
}

async function fetchFromWikidata(limit = BATCH_SIZE): Promise<TimelineEvent[]> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitMs = MIN_REQUEST_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const sparql = `
    SELECT ?event ?eventLabel ?date ?image ?article WHERE {
      ?event wdt:P31/wdt:P279* wd:Q1190554 .
      ?event wdt:P585 ?date .

      OPTIONAL { ?event wdt:P18 ?image }

      OPTIONAL {
        ?article schema:about ?event ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }

      FILTER(YEAR(?date) <= YEAR(NOW()))

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}
  `;

  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(
    sparql,
  )}&format=json`;

  const doRequest = async (): Promise<Response> => {
    lastRequestTime = Date.now();
    return fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
      },
    });
  };

  // First attempt.
  let res = await doRequest();

  if (res.status === 429) {
    console.warn("[EventService] Wikidata rate limited (429), retrying in 2s…");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // One retry after short delay.
    res = await doRequest();
  }

  if (!res.ok) {
    throw new Error(`Wikidata request failed with status ${res.status}`);
  }

  const json = await res.json();
  const bindings: WikidataBinding[] = json.results?.bindings ?? [];
  const normalized = normalizeBindings(bindings);

  console.log(
    "[EventService] fetched events from Wikidata:",
    normalized.length,
  );

  return normalized;
}

function refillCacheWith(events: TimelineEvent[]) {
  const existingIds = new Set(cachedEvents.map((e) => e.id));
  let added = 0;

  for (const event of events) {
    if (existingIds.has(event.id) || usedEventIds.has(event.id)) continue;
    cachedEvents.push(event);
    existingIds.add(event.id);
    added += 1;
  }

  if (added > 0) {
    console.log(
      `[EventService] cache refilled with ${added} events (cache size now ${cachedEvents.length})`,
    );
  }
}

function takeFromCache(): TimelineEvent | null {
  while (cachedEvents.length > 0) {
    const event = cachedEvents.shift()!;
    if (usedEventIds.has(event.id)) continue;
    usedEventIds.add(event.id);
    return event;
  }
  return null;
}

function getNextFromMock(): TimelineEvent | null {
  for (const event of EVENT_POOL) {
    if (usedEventIds.has(event.id)) continue;
    usedEventIds.add(event.id);
    return event;
  }
  return null;
}

export async function getNextEvent(): Promise<TimelineEvent | null> {
  // Top up cache aggressively when running low.
  if (cachedEvents.length < MIN_CACHE_SIZE) {
    try {
      const fresh = await fetchFromWikidata(BATCH_SIZE);
      console.log(
        "[EventService] fresh events fetched:",
        fresh.length,
        "current cache size before merge:",
        cachedEvents.length,
      );
      refillCacheWith(fresh);
    } catch (error) {
      console.warn(
        "[EventService] Wikidata fetch failed, will use mock events if needed:",
        error,
      );
    }
  }

  const fromCache = takeFromCache();
  if (fromCache) {
    console.log(
      "[EventService] serving event from cache. Remaining cache size:",
      cachedEvents.length,
    );
    return fromCache;
  }

  const fallback = getNextFromMock();
  if (fallback) {
    console.log("[EventService] using mock event:", fallback);
    return fallback;
  }

  return null;
}

