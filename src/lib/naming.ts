// Automatic file naming rules for batch and scheduled output. Pure and unit-tested.
// Tokens: {name} original name without .pdf · {op} operation · {index} or {index:3} counter ·
// {date} YYYY-MM-DD · {time} HH-MM (24h, local).

export interface NamingContext {
  name: string;
  op: string;
  index: number; // 1-based
  date: Date;
  ext?: string;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Removes characters that are not allowed in file names on Linux, Windows or macOS. */
export function sanitizeFileName(s: string): string {
  const replaced = s
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '-' : ch))
    .join('');
  return replaced
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
}

export function applyNamingRule(rule: string, c: NamingContext): string {
  const base = c.name.replace(/\.pdf$/i, '');
  const filled = rule
    .replace(/\{index(?::(\d+))?\}/g, (_m, width: string | undefined) => pad(c.index, width ? Number(width) : 1))
    .replace(/\{name\}/g, base)
    .replace(/\{op\}/g, c.op)
    .replace(/\{date\}/g, `${c.date.getFullYear()}-${pad(c.date.getMonth() + 1)}-${pad(c.date.getDate())}`)
    .replace(/\{time\}/g, `${pad(c.date.getHours())}-${pad(c.date.getMinutes())}`);
  const cleaned = sanitizeFileName(filled).slice(0, 180);
  return `${cleaned || sanitizeFileName(base) || 'document'}.${c.ext ?? 'pdf'}`;
}
