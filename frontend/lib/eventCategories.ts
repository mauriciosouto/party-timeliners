/**
 * Curated Wikidata category QIDs for positive/casual events.
 * Used by the ingestion script to build the local event pool.
 */
export const EVENT_CATEGORIES: Record<string, string> = {
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

  /** Special case: humans (Q5), use P569 (date of birth) in ingestion. */
  celebrityBirths: "Q5",
};
