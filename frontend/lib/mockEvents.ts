import type { TimelineEvent } from "./types";

export const INITIAL_TIMELINE: TimelineEvent[] = [
  {
    id: "printing-press",
    title: "Gutenberg invents the printing press",
    year: 1450,
    description: "Movable-type printing begins to spread in Europe.",
    image: "/vercel.svg",
  },
];

// Simple local deck for the single-player prototype.
// Later phases will replace this with live Wikipedia / Wikidata data.
export const EVENT_POOL: TimelineEvent[] = [
  {
    id: "pyramids",
    title: "Construction of the Great Pyramid of Giza",
    year: -2560,
    description: "One of the Seven Wonders of the Ancient World is completed.",
  },
  {
    id: "rome-founded",
    title: "Legendary founding of Rome",
    year: -753,
    description: "Traditional date for the founding of the city of Rome.",
  },
  {
    id: "magna-carta",
    title: "Signing of the Magna Carta",
    year: 1215,
    description: "English barons force King John to sign a charter of rights.",
  },
  {
    id: "columbus-1492",
    title: "Columbus reaches the Americas",
    year: 1492,
    description: "Christopher Columbus lands in the Caribbean.",
  },
  {
    id: "usa-independence",
    title: "Declaration of Independence (USA)",
    year: 1776,
    description: "The Thirteen Colonies declare independence from Britain.",
  },
  {
    id: "french-revolution",
    title: "French Revolution begins",
    year: 1789,
    description: "Storming of the Bastille marks the start of revolution.",
  },
  {
    id: "telephone-patent",
    title: "First telephone patented",
    year: 1876,
    description: "Alexander Graham Bell patents the telephone.",
  },
  {
    id: "ww1-begins",
    title: "World War I begins",
    year: 1914,
    description: "Global conflict begins after the assassination in Sarajevo.",
  },
  {
    id: "ww2-end",
    title: "End of World War II",
    year: 1945,
    description: "World War II ends with Allied victory.",
  },
  {
    id: "moon-landing",
    title: "Apollo 11 Moon Landing",
    year: 1969,
    description: "Neil Armstrong becomes the first human to walk on the Moon.",
    image: "/window.svg",
  },
  {
    id: "berlin-wall-falls",
    title: "Fall of the Berlin Wall",
    year: 1989,
    description: "The Berlin Wall is opened, symbolizing the end of the Cold War.",
  },
  {
    id: "internet",
    title: "Public release of the World Wide Web",
    year: 1991,
    description:
      "Tim Berners-Lee opens the World Wide Web to the general public.",
  },
  {
    id: "euro-introduced",
    title: "Euro currency introduced",
    year: 1999,
    description: "The euro is launched as the common currency for many EU countries.",
  },
  {
    id: "smartphone-era",
    title: "Smartphone era begins",
    year: 2007,
    description: "Modern smartphones popularize always-connected mobile computing.",
  },
  {
    id: "first-image-black-hole",
    title: "First image of a black hole",
    year: 2019,
    description: "Astronomers release the first direct image of a black hole.",
  },
];

