const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "who",
  "want",
  "this",
  "that",
  "their",
  "they",
  "will"
]);

export function cleanText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim();
}

export function getSectionHeadings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim().toLowerCase());
}

export function extractKeywords(text: string, max = 10): string[] {
  const counts = new Map<string, number>();
  const words = cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));

  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
}

export function findSectionContent(text: string, sectionNames: string[]): string {
  const lines = text.split("\n");
  const loweredNames = sectionNames.map((name) => name.toLowerCase());
  let collecting = false;
  const buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.replace(/^#{1,6}\s+/, "").toLowerCase();

    if (/^#{1,6}\s+/.test(trimmed) && loweredNames.includes(heading)) {
      collecting = true;
      continue;
    }

    if (collecting && /^#{1,6}\s+/.test(trimmed)) {
      break;
    }

    if (collecting) {
      buffer.push(trimmed);
    }
  }

  return cleanText(buffer.join("\n"));
}

export function extractBulletItems(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
