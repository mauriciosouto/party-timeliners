/**
 * Fetch events from Wikidata, normalize, filter, and dedupe.
 * Used by the refresh-events script and optionally by seed when DB is empty.
 */
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const CURRENT_YEAR = new Date().getUTCFullYear();
const CATEGORY_LIMIT = 120;
const CELEBRITY_BIRTH_LIMIT = 120;
const TARGET_POOL_SIZE = 300;
export const EVENT_CATEGORIES = {
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
const TYPE_LABELS = {
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
const THUMBNAIL_WIDTH = 300;
function buildCategoryQuery(qid) {
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
function getCelebrityBirthQuery() {
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
function parseYear(raw) {
    if (!raw)
        return null;
    const match = raw.match(/^([+-]?\d+)-/);
    if (!match)
        return null;
    const year = Number.parseInt(match[1], 10);
    if (Number.isNaN(year))
        return null;
    return year;
}
function getWikimediaThumbnail(imageName, width = THUMBNAIL_WIDTH) {
    let name = (imageName ?? "").trim();
    if (!name)
        return "";
    const filePathMatch = name.match(/FilePath\/([^?#]+)/i);
    if (filePathMatch) {
        name = decodeURIComponent(filePathMatch[1]);
    }
    if (name.startsWith("File:")) {
        name = name.slice(5).trim();
    }
    if (!name)
        return "";
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}
function normalizeBindings(bindings, typeLabel, entityKey = "event") {
    const labelKey = `${entityKey}Label`;
    const events = [];
    for (const b of bindings) {
        const entity = b[entityKey]?.value;
        const title = b[labelKey]?.value?.trim();
        if (!entity || !title)
            continue;
        const rawImage = b.image?.value?.trim();
        if (!rawImage)
            continue;
        const image = getWikimediaThumbnail(rawImage);
        if (!image)
            continue;
        const id = entity.split("/").pop() ?? entity;
        const year = parseYear(b.date?.value);
        if (year == null || year > CURRENT_YEAR)
            continue;
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
function isGoodEvent(event) {
    const title = event.title?.trim();
    if (!title)
        return false;
    if (title.length < 5 || title.length > 120)
        return false;
    if (typeof event.year !== "number" || Number.isNaN(event.year))
        return false;
    if (event.year > CURRENT_YEAR)
        return false;
    if (!event.wikipediaUrl)
        return false;
    if (!event.image)
        return false;
    if (RANGE_REGEX.test(title))
        return false;
    if (YEAR_IN_TITLE_REGEX.test(title))
        return false;
    return true;
}
async function runSparql(sparql) {
    const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`;
    const res = await fetch(url, {
        headers: {
            Accept: "application/sparql-results+json",
            "User-Agent": "PartyTimeliners/0.1 (https://party-timeliners.local; contact: dev@party-timeliners.local)",
        },
    });
    if (!res.ok)
        throw new Error(`Wikidata request failed with status ${res.status}`);
    const json = await res.json();
    return (json.results?.bindings ?? []);
}
async function fetchAllCategories() {
    const all = [];
    for (const [categoryKey, qid] of Object.entries(EVENT_CATEGORIES)) {
        const typeLabel = TYPE_LABELS[categoryKey] ?? categoryKey;
        try {
            if (categoryKey === "celebrityBirths") {
                const bindings = await runSparql(getCelebrityBirthQuery());
                all.push(...normalizeBindings(bindings, typeLabel, "person"));
            }
            else {
                const bindings = await runSparql(buildCategoryQuery(qid));
                all.push(...normalizeBindings(bindings, typeLabel, "event"));
            }
        }
        catch (error) {
            console.warn(`Failed to fetch ${typeLabel}:`, error);
        }
    }
    return all;
}
/**
 * Fetch events from Wikidata, apply quality filter, dedupe by id, and cap at TARGET_POOL_SIZE.
 * Does not touch the database.
 */
export async function fetchAndPrepareEventPool() {
    const all = await fetchAllCategories();
    const byId = new Map();
    for (const ev of all) {
        if (!byId.has(ev.id))
            byId.set(ev.id, ev);
    }
    let unique = Array.from(byId.values()).filter(isGoodEvent);
    if (unique.length > TARGET_POOL_SIZE) {
        unique = unique.slice(0, TARGET_POOL_SIZE);
    }
    return unique;
}
