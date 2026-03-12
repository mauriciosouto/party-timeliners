import type { TimelineEvent } from "./types";

export const INITIAL_TIMELINE: TimelineEvent[] = [
  {
    id: "printing-press",
    title: "Gutenberg invents the printing press",
    year: 1450,
    description: "Movable-type printing begins to spread in Europe.",
  },
];

// Simple local deck for the Phase 1 prototype.
// Later phases will replace this with live Wikipedia / Wikidata data.
export const EVENT_POOL: TimelineEvent[] = [
  {
    id: "pyramids",
    title: "Construction of the Great Pyramid of Giza",
    year: -2560,
    description: "One of the Seven Wonders of the Ancient World is completed.",
  },
  {
    id: "moon-landing",
    title: "Apollo 11 Moon Landing",
    year: 1969,
    description: "Neil Armstrong becomes the first human to walk on the Moon.",
  },
  {
    id: "ww2-end",
    title: "End of World War II",
    year: 1945,
    description: "World War II ends with Allied victory.",
  },
  {
    id: "internet",
    title: "Public release of the World Wide Web",
    year: 1991,
    description:
      "Tim Berners-Lee opens the World Wide Web to the general public.",
  },
];

