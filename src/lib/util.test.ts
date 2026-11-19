import { describe, expect, it } from 'vitest';
import { LRU, formatBytes, formatDuration, parseRangeParts, parseRanges, range, setLocale } from './util';

describe('page ranges', () => {
  it('parses mixed ranges in order without duplicates', () => {
    expect(parseRanges('1-3,5,2', 10)).toEqual([0, 1, 2, 4]);
  });

  it('accepts reversed ranges', () => {
    expect(parseRanges('3-1', 5)).toEqual([2, 1, 0]);
  });

  it('keeps one group per comma part', () => {
    expect(parseRangeParts('1-2,2', 3)).toEqual([
      [0, 1],
      [1],
    ]);
  });

  it('rejects zero, out-of-range and malformed input with a friendly message', () => {
    expect(() => parseRanges('0', 5)).toThrow(/outside/);
    expect(() => parseRanges('9', 5)).toThrow(/outside/);
    expect(() => parseRanges('abc', 5)).toThrow(/Invalid range/);
    expect(() => parseRanges('  ', 5)).toThrow(/Enter at least one/);
  });
});

describe('LRU cache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.has('a')).toBe(false);
    expect(c.get('b')).toBe(2);
    c.set('d', 4);
    expect(c.has('c')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.size).toBe(2);
  });
});

describe('formatting', () => {
  it('formats byte sizes with units', () => {
    setLocale('en');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toMatch(/KB$/);
    expect(formatBytes(5 * 1024 * 1024)).toMatch(/MB$/);
  });

  it('formats durations compactly', () => {
    expect(formatDuration(4200)).toBe('4s');
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  it('range is half-open', () => {
    expect(range(2, 5)).toEqual([2, 3, 4]);
    expect(range(3, 3)).toEqual([]);
  });
});
