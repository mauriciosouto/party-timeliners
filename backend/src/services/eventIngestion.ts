/**
 * Fetch events from Wikidata, normalize, filter, and dedupe.
 * Used by the refresh-events script and optionally by seed when DB is empty.
 */

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const CURRENT_YEAR = new Date().getUTCFullYear();
/** Phase1: lightweight query limit (no article/label). Keep low to avoid 504. */
const PHASE1_LIMIT = 25;
const HISTORICAL_PHASE1_LIMIT = 15;
const CELEBRITY_PHASE1_LIMIT = 25;
export const TARGET_POOL_SIZE = 300;
/** Max events per category when merging; above this, new events replace a random one in that category. */
export const LIMIT_PER_CATEGORY = 200;
/** Pause between category requests to avoid overloading the endpoint. */
const CATEGORY_DELAY_MS = 800;
/** Number of phase1 runs per category (different year ranges); results combined then one enrich. */
const PHASE1_RUNS_PER_CATEGORY = 3;

/** Max year for events (avoid very recent; keep pool recognizable). */
const MAX_YEAR = 2018;

/** Min year per category for recognizability (pop culture modern, history from WWI, etc.). */
const CATEGORY_MIN_YEAR: Record<string, number> = {
  films: 1980,
  books: 1980,
  videoGames: 1980,
  musicAlbums: 1980,
  songs: 1980,
  tvSeries: 1980,
  inventions: 1970,
  scientificDiscoveries: 1900,
  medicalDiscoveries: 1900,
  spaceMissions: 1957,
  software: 1970,
  consumerProducts: 1970,
  awards: 1900,
  festivals: 1900,
};

/** QIDs for historical event types (P31) fetched in one query via VALUES. */
const HISTORICAL_EVENT_TYPE_QIDS = [
  "Q178561",   // battle
  "Q2695280",  // invention
  "Q11862829", // scientific discovery
  "Q7189713",  // medical discovery
  "Q2133344",  // space mission
];

export const EVENT_CATEGORIES: Record<string, string> = {
  films: "Q11424",
  books: "Q571",
  videoGames: "Q7889",
  musicAlbums: "Q482994",
  songs: "Q7366",
  tvSeries: "Q5398426",
  historicalEvents: "",
  inventions: "Q161928",
  scientificDiscoveries: "Q11862829",
  medicalDiscoveries: "Q11190",
  spaceMissions: "Q5916",
  software: "Q7397",
  consumerProducts: "Q2424752",
  awards: "Q618779",
  festivals: "Q132241",
  celebrityBirths: "Q5",
};

const TYPE_LABELS: Record<string, string> = {
  films: "Film",
  books: "Book",
  videoGames: "Video game",
  musicAlbums: "Music album",
  songs: "Song",
  tvSeries: "TV series",
  historicalEvents: "Historical event",
  inventions: "Invention",
  scientificDiscoveries: "Scientific discovery",
  medicalDiscoveries: "Medical discovery",
  spaceMissions: "Space mission",
  software: "Software",
  consumerProducts: "Consumer product",
  awards: "Award",
  festivals: "Festival",
  celebrityBirths: "Year of Birth",
};

const RANGE_REGEX = /\d{4}[-–]\d{2}/;
const YEAR_IN_TITLE_REGEX = /\b(1[0-9]{3}|20[0-9]{2})\b/;
const THUMBNAIL_WIDTH = 300;

type Binding = {
  event?: { value: string };
  eventLabel?: { value: string };
  person?: { value: string };
  personLabel?: { value: string };
  date?: { value: string };
  image?: { value: string };
  article?: { value: string };
};

export type IngestedEvent = {
  id: string;
  title: string;
  type: string;
  displayTitle: string;
  year: number;
  image: string;
  wikipediaUrl: string;
  /** Wikipedia page title (e.g. Apollo_11) for pageviews API. Derived from wikipediaUrl. */
  wikiTitle?: string;
  /** Sum of last 12 months pageviews; used to prefer recognizable events. */
  popularityScore?: number;
};

/** Extract Wikipedia page title from article URL (e.g. https://en.wikipedia.org/wiki/Apollo_11 → Apollo_11). */
function getWikiTitle(wikipediaUrl: string): string | null {
  if (!wikipediaUrl?.trim()) return null;
  try {
    const u = new URL(wikipediaUrl);
    const match = u.pathname.match(/\/wiki\/(.+)$/);
    if (!match) return null;
    return decodeURIComponent(match[1].replace(/\+/g, " ")).trim() || null;
  } catch {
    return null;
  }
}

const PAGEVIEWS_CACHE = new Map<string, number>();
const PAGEVIEWS_CONCURRENCY = 4;
const PAGEVIEWS_YEAR = "2023";
const PAGEVIEWS_START = `${PAGEVIEWS_YEAR}0101`;
const PAGEVIEWS_END = `${PAGEVIEWS_YEAR}1231`;

/** Fetch last-12-months pageviews for a Wikipedia title; uses in-memory cache. */
async function fetchPageviewsForTitle(title: string): Promise<number> {
  const cached = PAGEVIEWS_CACHE.get(title);
  if (cached !== undefined) return cached;
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encoded}/monthly/${PAGEVIEWS_START}/${PAGEVIEWS_END}`;
  try {
    const res = await withRetry(
      () =>
        fetch(url, {
          headers: {
            "User-Agent":
              "PartyTimeliners/0.1 (https://party-timeliners.local; contact: dev@party-timeliners.local)",
          },
        }),
      "Pageviews",
    );
    if (!res.ok) {
      PAGEVIEWS_CACHE.set(title, 0);
      return 0;
    }
    const data = (await res.json()) as { items?: { views: number }[] };
    const sum = (data.items ?? []).reduce((acc, i) => acc + (i.views ?? 0), 0);
    PAGEVIEWS_CACHE.set(title, sum);
    return sum;
  } catch {
    PAGEVIEWS_CACHE.set(title, 0);
    return 0;
  }
}

/** Run at most `concurrency` promises at a time. */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const i = index++;
    if (i >= items.length) return;
    await fn(items[i]!);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/** Fetch pageviews for all events (by wikiTitle), set popularityScore. Only requests titles not in cache; limits concurrency. */
async function fetchPageviewsForEvents(events: IngestedEvent[]): Promise<void> {
  const byTitle = new Map<string, IngestedEvent[]>();
  for (const e of events) {
    const title = getWikiTitle(e.wikipediaUrl);
    if (!title) {
      e.popularityScore = 0;
      continue;
    }
    e.wikiTitle = title;
    const list = byTitle.get(title) ?? [];
    list.push(e);
    byTitle.set(title, list);
  }
  const titlesToFetch = Array.from(byTitle.keys()).filter((t) => !PAGEVIEWS_CACHE.has(t));
  await runWithConcurrency(titlesToFetch, PAGEVIEWS_CONCURRENCY, async (title) => {
    await fetchPageviewsForTitle(title);
  });
  for (const e of events) {
    const t = e.wikiTitle ?? getWikiTitle(e.wikipediaUrl);
    e.popularityScore = t != null ? (PAGEVIEWS_CACHE.get(t) ?? 0) : 0;
  }
}

/** Phase 1: only ?event ?date ?image — no schema:about, no label service. Much lighter. */
function buildCategoryQueryPhase1(qid: string, minYear: number, maxYear: number): string {
  const minDt = `"${minYear}-01-01T00:00:00Z"^^xsd:dateTime`;
  const maxDt = `"${maxYear}-12-31T23:59:59Z"^^xsd:dateTime`;
  return `
SELECT ?event ?date ?image WHERE {
  {
    SELECT ?event ?date WHERE {
      ?event wdt:P31 wd:${qid} .
      { ?event wdt:P577 ?date . hint:Prior hint:rangeSafe true . }
      UNION
      { ?event wdt:P585 ?date . hint:Prior hint:rangeSafe true . }
      UNION
      { ?event wdt:P571 ?date . hint:Prior hint:rangeSafe true . }
      FILTER(?date >= ${minDt} && ?date <= ${maxDt})
    }
    LIMIT ${PHASE1_LIMIT}
  }
  ?event wdt:P18 ?image .
}
`.trim();
}

function buildHistoricalEventTypePhase1(
  typeQid: string,
  rangeMinYear: number = 1914,
  rangeMaxYear: number = MAX_YEAR,
): string {
  const minDt = `"${rangeMinYear}-01-01T00:00:00Z"^^xsd:dateTime`;
  const maxDt = `"${rangeMaxYear}-12-31T23:59:59Z"^^xsd:dateTime`;
  return `
SELECT ?event ?date ?image WHERE {
  {
    SELECT ?event ?date WHERE {
      ?event wdt:P31 wd:${typeQid} .
      { ?event wdt:P577 ?date . hint:Prior hint:rangeSafe true . }
      UNION
      { ?event wdt:P585 ?date . hint:Prior hint:rangeSafe true . }
      UNION
      { ?event wdt:P571 ?date . hint:Prior hint:rangeSafe true . }
      FILTER(?date >= ${minDt} && ?date <= ${maxDt})
    }
    LIMIT ${HISTORICAL_PHASE1_LIMIT}
  }
  ?event wdt:P18 ?image .
}
`.trim();
}

function getCelebrityBirthQueryPhase1(
  rangeMinYear: number = 1950,
  rangeMaxYear: number = MAX_YEAR,
): string {
  const minDt = `"${rangeMinYear}-01-01T00:00:00Z"^^xsd:dateTime`;
  const maxDt = `"${rangeMaxYear}-12-31T23:59:59Z"^^xsd:dateTime`;
  return `
SELECT ?person ?date ?image WHERE {
  {
    SELECT ?person ?date WHERE {
      VALUES ?occupation {
        wd:Q33999 wd:Q10800557 wd:Q177220 wd:Q639669 wd:Q488205 wd:Q2526255
      }
      ?person wdt:P106 ?occupation .
      ?person wdt:P569 ?date . hint:Prior hint:rangeSafe true .
      FILTER(?date >= ${minDt} && ?date <= ${maxDt})
    }
    LIMIT ${CELEBRITY_PHASE1_LIMIT}
  }
  ?person wdt:P18 ?image .
}
`.trim();
}

/** Split [minYear, maxYear] into n roughly equal ranges for multiple phase1 runs. */
function getYearRanges(
  minYear: number,
  maxYear: number,
  n: number = PHASE1_RUNS_PER_CATEGORY,
): [number, number][] {
  const span = Math.max(1, Math.ceil((maxYear - minYear + 1) / n));
  const ranges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = minYear + i * span;
    const b = i === n - 1 ? maxYear : Math.min(minYear + (i + 1) * span - 1, maxYear);
    if (a <= b) ranges.push([a, b]);
  }
  return ranges;
}

/** Enrich: label + article for a small set of entities (VALUES). Uses rdfs:label instead of label service. */
function buildEnrichQuery(entityIds: string[], entityKey: "event" | "person"): string {
  if (entityIds.length === 0) return "";
  const labelVar = `${entityKey}Label`;
  const wdValues = entityIds
    .map((id) => {
      const q = id.replace(/^.*\//, "").replace(/^wd:/, "");
      return q ? `wd:${q}` : null;
    })
    .filter(Boolean) as string[];
  if (wdValues.length === 0) return "";
  const valuesBlock = wdValues.join(" ");
  return `
SELECT ?${entityKey} ?${labelVar} ?article WHERE {
  VALUES ?${entityKey} { ${valuesBlock} }
  ?article schema:about ?${entityKey} ; schema:isPartOf <https://en.wikipedia.org/> .
  ?${entityKey} rdfs:label ?${labelVar} . FILTER(LANG(?${labelVar}) = "en")
}
`.trim();
}

function parseYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/^([+-]?\d+)-/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  if (Number.isNaN(year)) return null;
  return year;
}

function getWikimediaThumbnail(
  imageName: string,
  width = THUMBNAIL_WIDTH,
): string {
  let name = (imageName ?? "").trim();
  if (!name) return "";
  const filePathMatch = name.match(/FilePath\/([^?#]+)/i);
  if (filePathMatch) {
    name = decodeURIComponent(filePathMatch[1]);
  }
  if (name.startsWith("File:")) {
    name = name.slice(5).trim();
  }
  if (!name) return "";
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

function normalizeBindings(
  bindings: Binding[],
  typeLabel: string,
  entityKey: "event" | "person" = "event",
): IngestedEvent[] {
  const labelKey = `${entityKey}Label` as keyof Binding;
  const events: IngestedEvent[] = [];

  for (const b of bindings) {
    const entity = b[entityKey]?.value;
    const title = (b[labelKey] as { value?: string } | undefined)?.value?.trim();
    if (!entity || !title) continue;

    const rawImage = b.image?.value?.trim();
    if (!rawImage) continue;

    const image = getWikimediaThumbnail(rawImage);
    if (!image) continue;

    const id = entity.split("/").pop() ?? entity;
    const year = parseYear(b.date?.value);
    if (year == null || year > CURRENT_YEAR) continue;

    const wikipediaUrl = b.article?.value ?? "";

    events.push({
      id,
      title,
      type: typeLabel,
      displayTitle: `${title} (${typeLabel})`,
      year,
      image,
      wikipediaUrl,
    });
  }

  return events;
}

/** Merge phase1 (event, date, image) with enrich (event, label, article) by entity ID. */
function mergePhase1AndEnrich(
  phase1: Binding[],
  enrich: Binding[],
  typeLabel: string,
  entityKey: "event" | "person",
): IngestedEvent[] {
  const labelKey = `${entityKey}Label` as keyof Binding;
  const byEntity = new Map<string, Binding>();
  for (const b of enrich) {
    const entity = b[entityKey]?.value;
    if (entity && b.article?.value) byEntity.set(entity, b);
  }
  const out: IngestedEvent[] = [];
  for (const p of phase1) {
    const entity = p[entityKey]?.value;
    if (!entity) continue;
    const e = byEntity.get(entity);
    if (!e) continue;
    const title = (e[labelKey] as { value?: string } | undefined)?.value?.trim();
    if (!title) continue;
    const rawImage = p.image?.value?.trim();
    if (!rawImage) continue;
    const image = getWikimediaThumbnail(rawImage);
    if (!image) continue;
    const id = entity.split("/").pop() ?? entity;
    const year = parseYear(p.date?.value);
    if (year == null || year > CURRENT_YEAR) continue;
    out.push({
      id,
      title,
      type: typeLabel,
      displayTitle: `${title} (${typeLabel})`,
      year,
      image,
      wikipediaUrl: e.article?.value ?? "",
    });
  }
  return out;
}

function isGoodEvent(event: IngestedEvent): boolean {
  const title = event.title?.trim();
  if (!title) return false;
  if (title.length < 5 || title.length > 120) return false;
  if (typeof event.year !== "number" || Number.isNaN(event.year)) return false;
  if (event.year > CURRENT_YEAR) return false;
  if (!event.wikipediaUrl) return false;
  if (!event.image) return false;
  if (RANGE_REGEX.test(title)) return false;
  if (YEAR_IN_TITLE_REGEX.test(title)) return false;
  return true;
}

const SPARQL_TIMEOUT_SEC = 60;
const FETCH_MAX_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 2000;

function isRetryableNetworkError(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : null;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND") return true;
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  return cause != null && isRetryableNetworkError(cause);
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_MAX_RETRIES && isRetryableNetworkError(err)) {
        console.warn(`[events] ${label} failed (attempt ${attempt}/${FETCH_MAX_RETRIES}), retrying in ${FETCH_RETRY_DELAY_MS}ms:`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function runSparql(sparql: string): Promise<Binding[]> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json&timeout=${SPARQL_TIMEOUT_SEC * 1000}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent":
          "PartyTimeliners/0.1 (https://party-timeliners.local; contact: dev@party-timeliners.local)",
      },
    });
    if (!res.ok) throw new Error(`Wikidata request failed with status ${res.status}`);
    const json = await res.json();
    return (json.results?.bindings ?? []) as Binding[];
  }, "Wikidata SPARQL");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run phase1 query, then enrich (label+article) for those IDs; merge. Two-phase avoids 504. */
async function fetchCategoryTwoPhase(
  phase1Sparql: string,
  enrichEntityKey: "event" | "person",
  typeLabel: string,
): Promise<IngestedEvent[]> {
  const phase1 = await runSparql(phase1Sparql);
  const entityKey = enrichEntityKey;
  const ids = phase1
    .map((b) => b[entityKey]?.value)
    .filter(Boolean) as string[];
  if (ids.length === 0) return [];
  const enrichQuery = buildEnrichQuery(ids, enrichEntityKey);
  if (!enrichQuery) return [];
  await delay(CATEGORY_DELAY_MS);
  const enrich = await runSparql(enrichQuery);
  return mergePhase1AndEnrich(phase1, enrich, typeLabel, enrichEntityKey);
}

/** Run N phase1 queries (e.g. different year ranges), combine and dedupe bindings, then one enrich and merge. */
async function fetchCategoryTwoPhaseWithRuns(
  phase1Sparqls: string[],
  enrichEntityKey: "event" | "person",
  typeLabel: string,
): Promise<IngestedEvent[]> {
  const entityKey = enrichEntityKey;
  const phase1ByEntity = new Map<string, Binding>();
  for (let i = 0; i < phase1Sparqls.length; i++) {
    const bindings = await runSparql(phase1Sparqls[i]!);
    for (const b of bindings) {
      const entity = b[entityKey]?.value;
      if (entity && !phase1ByEntity.has(entity)) phase1ByEntity.set(entity, b);
    }
    if (i < phase1Sparqls.length - 1) await delay(CATEGORY_DELAY_MS);
  }
  const phase1 = Array.from(phase1ByEntity.values());
  const ids = phase1.map((b) => b[entityKey]?.value).filter(Boolean) as string[];
  if (ids.length === 0) return [];
  const enrichQuery = buildEnrichQuery(ids, enrichEntityKey);
  if (!enrichQuery) return [];
  await delay(CATEGORY_DELAY_MS);
  const enrich = await runSparql(enrichQuery);
  return mergePhase1AndEnrich(phase1, enrich, typeLabel, enrichEntityKey);
}

/** Fetch events for a single category (Wikidata). Used by fetchAllCategories and fetchCategoriesIncremental. */
async function fetchOneCategory(
  categoryKey: string,
  qid: string,
): Promise<IngestedEvent[]> {
  const typeLabel = (key: string) => TYPE_LABELS[key] ?? key;
  const label = typeLabel(categoryKey);

  if (categoryKey === "celebrityBirths") {
    const ranges = getYearRanges(1950, MAX_YEAR);
    const phase1Sparqls = ranges.map(([a, b]) => getCelebrityBirthQueryPhase1(a, b));
    return fetchCategoryTwoPhaseWithRuns(phase1Sparqls, "person", label);
  }
  if (categoryKey === "historicalEvents") {
    const all: IngestedEvent[] = [];
    const ranges = getYearRanges(1914, MAX_YEAR);
    for (const typeQid of HISTORICAL_EVENT_TYPE_QIDS) {
      const phase1Sparqls = ranges.map(([a, b]) =>
        buildHistoricalEventTypePhase1(typeQid, a, b),
      );
      const events = await fetchCategoryTwoPhaseWithRuns(phase1Sparqls, "event", label);
      all.push(...events);
      await delay(CATEGORY_DELAY_MS);
    }
    return all;
  }
  const minYear = CATEGORY_MIN_YEAR[categoryKey] ?? 1900;
  const ranges = getYearRanges(minYear, MAX_YEAR);
  const phase1Sparqls = ranges.map(([a, b]) => buildCategoryQueryPhase1(qid, a, b));
  return fetchCategoryTwoPhaseWithRuns(phase1Sparqls, "event", label);
}

async function fetchAllCategories(): Promise<IngestedEvent[]> {
  const all: IngestedEvent[] = [];
  const typeLabel = (key: string) => TYPE_LABELS[key] ?? key;

  for (const [categoryKey, qid] of Object.entries(EVENT_CATEGORIES)) {
    const label = typeLabel(categoryKey);
    try {
      console.log(`[events] Loading category: ${label}...`);
      const events = await fetchOneCategory(categoryKey, qid);
      all.push(...events);
      console.log(`[events] ${label}: ${events.length} eventos`);
    } catch (error) {
      console.warn(`Failed to fetch ${label}:`, error);
    }
    await delay(CATEGORY_DELAY_MS);
  }

  return all;
}

/**
 * Yields each category's events as soon as they are fetched and filtered.
 * Caller can merge into the DB after each yield so the pool is usable incrementally.
 */
export async function* fetchCategoriesIncremental(): AsyncGenerator<
  { categoryKey: string; events: IngestedEvent[] },
  void,
  void
> {
  const typeLabel = (key: string) => TYPE_LABELS[key] ?? key;

  for (const [categoryKey, qid] of Object.entries(EVENT_CATEGORIES)) {
    const label = typeLabel(categoryKey);
    try {
      console.log(`[events] Loading category: ${label}...`);
      const raw = await fetchOneCategory(categoryKey, qid);
      const events = raw.filter(isGoodEvent);
      await fetchPageviewsForEvents(events);
      console.log(`[events] ${label}: ${events.length} eventos (after filter)`);
      yield { categoryKey, events };
    } catch (error) {
      console.warn(`Failed to fetch ${label}:`, error);
    }
    await delay(CATEGORY_DELAY_MS);
  }
}

/**
 * Fetch events from Wikidata, apply quality filter, dedupe by id,
 * fetch Wikipedia pageviews for popularity, sort by popularity, and cap at TARGET_POOL_SIZE.
 * Does not touch the database.
 */
export async function fetchAndPrepareEventPool(): Promise<IngestedEvent[]> {
  const all = await fetchAllCategories();
  const byId = new Map<string, IngestedEvent>();
  for (const ev of all) {
    if (!byId.has(ev.id)) byId.set(ev.id, ev);
  }
  let unique = Array.from(byId.values()).filter(isGoodEvent);
  await fetchPageviewsForEvents(unique);
  unique.sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
  if (unique.length > TARGET_POOL_SIZE) {
    unique = unique.slice(0, TARGET_POOL_SIZE);
  }
  return unique;
}

/** Event-like shape used when merging; existing pool may come from DB with optional fields and refreshed_at for per-event TTL. */
export type PoolEventLike = Pick<IngestedEvent, "id" | "type"> & Partial<IngestedEvent> & { refreshed_at?: string };

/** IngestedEvent with optional refreshed_at (set when event was last written to the pool; used for per-event TTL). */
export type PoolEventWithRefreshed = IngestedEvent & { refreshed_at?: string };

/**
 * Merge new candidates into existing pool without wiping it.
 * Preserves refreshed_at from existing events so per-event TTL is respected.
 * - If candidate.id is already in existing, skip.
 * - If category has < limitPerCategory: add candidate.
 * - If category has >= limitPerCategory: replace a random event of that category with candidate.
 * Returns the merged list (existing + added/replaced).
 */
export function mergeWithExistingPool(
  existing: PoolEventLike[],
  newCandidates: IngestedEvent[],
  limitPerCategory: number = LIMIT_PER_CATEGORY,
): PoolEventWithRefreshed[] {
  const byId = new Map<string, PoolEventLike>();
  for (const e of existing) {
    byId.set(e.id, e);
  }
  const merged: PoolEventWithRefreshed[] = existing.map((e) => ({
    ...toIngestedEvent(e),
    refreshed_at: e.refreshed_at,
  }));
  const byTypeIndices = new Map<string, number[]>();
  merged.forEach((e, i) => {
    const list = byTypeIndices.get(e.type) ?? [];
    list.push(i);
    byTypeIndices.set(e.type, list);
  });

  for (const c of newCandidates) {
    if (byId.has(c.id)) continue;
    const category = c.type;
    const indices = byTypeIndices.get(category) ?? [];
    if (indices.length < limitPerCategory) {
      merged.push(c);
      byId.set(c.id, c);
      indices.push(merged.length - 1);
      byTypeIndices.set(category, indices);
    } else {
      const randomIdx = indices[Math.floor(Math.random() * indices.length)]!;
      const old = merged[randomIdx]!;
      byId.delete(old.id);
      byId.set(c.id, c);
      merged[randomIdx] = c;
    }
  }
  return merged;
}

function toIngestedEvent(e: PoolEventLike): IngestedEvent {
  return {
    id: e.id,
    title: e.title ?? "",
    type: e.type,
    displayTitle: e.displayTitle ?? `${e.title ?? ""} (${e.type})`,
    year: e.year ?? 0,
    image: e.image ?? "",
    wikipediaUrl: e.wikipediaUrl ?? "",
    popularityScore: e.popularityScore,
  };
}
