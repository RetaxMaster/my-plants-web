// Word-count → reading-time estimate. Extracted from the blog editor so the editor and the public
// draft preview share ONE implementation (no fork — constitution). ~200 words/minute, floored at 1
// so even a one-line post reads as "1 min", never "0 min".
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function readingMinutes(text: string): number {
  return Math.max(1, Math.ceil(countWords(text) / 200));
}
