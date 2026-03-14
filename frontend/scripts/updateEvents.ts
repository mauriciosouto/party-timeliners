/* eslint-disable no-console */
/**
 * @deprecated Event ingestion and pool refresh live on the backend.
 * Use: cd backend && npm run refresh-events (or POST /api/admin/refresh-events).
 * This script is kept only for one-off export to JSON if needed.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Mirrors lib/eventCategories.ts so the script runs without ESM resolution. */
const EVENT_CATEGORIES: Record<string, string> = {
  films: "Q11424",
  books: "Q571",
  videoGames: "Q7889",
  musicAlbums: "Q482994",
  songs: "Q7366",
  tvSeries: "Q5398426",
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

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const CURRENT_YEAR = new Date().getUTCFullYear();
const CATEGORY_LIMIT = 120;
const CELEBRITY_BIRTH_LIMIT = 120;
const TARGET_POOL_SIZE = 300;

type Binding = {
  event?: { value: string };
  eventLabel?: { value: string };
  person?: { value: string };
  personLabel?: { value: string };
  date?: { value: string };
  image?: { value: string };
  article?: { value: string };
};

type Event = {
  id: string;
  title: string;
  type: string;
  displayTitle: string;
  year: number;
  image?: string;
  wikipediaUrl?: string;
};

const TYPE_LABELS: Record<string, string> = {
  films: "Film",
  books: "Book",
  videoGames: "Video game",
  musicAlbums: "Music album",
  songs: "Song",
  tvSeries: "TV series",
  inventions: "Invention",
  scientificDiscoveries: "Scientific discovery",
  medicalDiscoveries: "Medical discovery",
  spaceMissions: "Space mission",
  software: "Software",
  consumerProducts: "Consumer product",
  awards: "Award",
  festivals: "Festival",
  celebrityBirths: "Celebrity birth",
};

const RANGE_REGEX = /\d{4}[-–]\d{2}/;
const YEAR_IN_TITLE_REGEX = /\b(1[0-9]{3}|20[0-9]{2})\b/;

function buildCategoryQuery(qid: string): string {
  return `
SELECT ?event ?eventLabel ?date ?image ?article WHERE {
  ?event wdt:P31 wd:${qid} .
  {
    ?event wdt:P577 ?date .
  }
  UNION
  {
    ?event wdt:P585 ?date .
  }
  UNION
  {
    ?event wdt:P571 ?date .
  }

  FILTER(YEAR(?date) > -3000 && YEAR(?date) <= YEAR(NOW()))

  OPTIONAL { ?event wdt:P18 ?image }

  ?article schema:about ?event ;
           schema:isPartOf <https://en.wikipedia.org/> .

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${CATEGORY_LIMIT}
`.trim();
}

function getCelebrityBirthQuery(): string {
  return `
SELECT ?person ?personLabel ?date ?image ?article WHERE {
  ?person wdt:P31 wd:Q5 .
  ?person wdt:P569 ?date .

  OPTIONAL { ?person wdt:P18 ?image }

  ?article schema:about ?person ;
           schema:isPartOf <https://en.wikipedia.org/> .

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${CELEBRITY_BIRTH_LIMIT}
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

const THUMBNAIL_WIDTH = 300;

/** Mirrors lib/imageUtils: normalize filename and build Commons thumbnail URL. */
function getWikimediaThumbnail(imageName: string, width = THUMBNAIL_WIDTH): string {
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
  const encoded = encodeURIComponent(name);
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

function normalizeBindings(
  bindings: Binding[],
  typeLabel: string,
  entityKey: "event" | "person" = "event",
): Event[] {
  const labelKey = `${entityKey}Label` as keyof Binding;
  const events: Event[] = [];

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

    events.push({
      id,
      title,
      type: typeLabel,
      displayTitle: `${title} (${typeLabel})`,
      year,
      image,
      wikipediaUrl: b.article?.value,
    });
  }

  return events;
}

function isGoodEvent(event: Event): boolean {
  const title = event.title?.trim();
  if (!title) return false;
  if (title.length < 5 || title.length > 120) return false;

  const year = event.year;
  if (typeof year !== "number" || Number.isNaN(year)) return false;
  if (year > CURRENT_YEAR) return false;
  if (!event.wikipediaUrl) return false;
  if (!event.image) return false;
  if (RANGE_REGEX.test(title)) return false;
  if (YEAR_IN_TITLE_REGEX.test(title)) return false;

  return true;
}

async function runSparql(sparql: string): Promise<Binding[]> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent":
        "PartyTimeliners/0.1 (https://party-timeliners.local; contact: dev@party-timeliners.local)",
    },
  });

  if (!res.ok) {
    throw new Error(`Wikidata request failed with status ${res.status}`);
  }

  const json = await res.json();
  return (json.results?.bindings ?? []) as Binding[];
}

async function fetchAllCategories(): Promise<Event[]> {
  const all: Event[] = [];

  for (const [categoryKey, qid] of Object.entries(EVENT_CATEGORIES)) {
    const typeLabel = TYPE_LABELS[categoryKey] ?? categoryKey;

    try {
      if (categoryKey === "celebrityBirths") {
        const sparql = getCelebrityBirthQuery();
        console.log(`Fetching ${typeLabel}...`);
        const bindings = await runSparql(sparql);
        console.log(`  Raw: ${bindings.length}`);
        all.push(...normalizeBindings(bindings, typeLabel, "person"));
      } else {
        const sparql = buildCategoryQuery(qid);
        console.log(`Fetching ${typeLabel} (${qid})...`);
        const bindings = await runSparql(sparql);
        console.log(`  Raw: ${bindings.length}`);
        all.push(...normalizeBindings(bindings, typeLabel, "event"));
      }
    } catch (error) {
      console.warn(`Failed to fetch ${typeLabel}:`, error);
    }
  }

  return all;
}

async function main() {
  console.log("Fetching all categories from Wikidata...\n");

  const all = await fetchAllCategories();
  console.log("\nTotal normalized events before filtering:", all.length);

  const byId = new Map<string, Event>();
  for (const ev of all) {
    if (!byId.has(ev.id)) byId.set(ev.id, ev);
  }
  let unique = Array.from(byId.values());

  unique = unique.filter(isGoodEvent);
  console.log("Events after quality filter:", unique.length);

  if (unique.length > TARGET_POOL_SIZE) {
    unique = unique.slice(0, TARGET_POOL_SIZE);
  }

  const outputPath = path.join(process.cwd(), "data", "eventPool.json");
  await fs.writeFile(outputPath, JSON.stringify(unique, null, 2), "utf8");

  console.log(`Wrote ${unique.length} events to ${outputPath}.`);
}

main().catch((error) => {
  console.error("Failed to update event pool:", error);
  process.exitCode = 1;
});
