const COMMONS_FILEPATH_PREFIX =
  "https://commons.wikimedia.org/wiki/Special:FilePath/";

/**
 * Normalizes a Wikidata P18 image value to a plain filename.
 * Handles "File:Example.jpg" and full Commons URLs.
 */
function normalizeImageName(value: string): string {
  let name = value.trim();
  if (!name) return "";

  const filePathMatch = name.match(/FilePath\/([^?#]+)/i);
  if (filePathMatch) {
    name = decodeURIComponent(filePathMatch[1]);
  }

  if (name.startsWith("File:")) {
    name = name.slice(5).trim();
  }

  return name;
}

/**
 * Returns a Wikimedia Commons thumbnail URL for the given image name or raw URL.
 * Uses Special:FilePath with a width parameter for optimized loading.
 *
 * @param imageName - Filename (e.g. "Star_Wars_1977_poster.jpg"), "File:...", or full Commons URL
 * @param width - Desired width in pixels (default 300)
 */
export function getWikimediaThumbnail(
  imageName: string,
  width = 300,
): string {
  const name = normalizeImageName(imageName);
  if (!name) return "";
  const encoded = encodeURIComponent(name);
  return `${COMMONS_FILEPATH_PREFIX}${encoded}?width=${width}`;
}
