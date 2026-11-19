// Verification of redaction and replacement against the extracted text layer. Pure and unit-tested.
// Limit: this checks the text layer only. Pixels inside rasterized pages are not inspected.

function squash(s: string, caseSensitive: boolean): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return caseSensitive ? t : t.toLowerCase();
}

/** Number of occurrences of `needle` in the given page texts. */
export function countResidual(pageTexts: string[], needle: string, caseSensitive = false): number {
  const n = squash(needle, caseSensitive);
  if (!n) return 0;
  let count = 0;
  for (const text of pageTexts) {
    const t = squash(text, caseSensitive);
    let i = t.indexOf(n);
    while (i >= 0) {
      count++;
      i = t.indexOf(n, i + n.length);
    }
  }
  return count;
}
