import { describe, expect, it } from 'vitest';
import { evaluateAccessibility, type A11yInput } from './a11y';

const good: A11yInput = {
  title: 'Annual report',
  language: 'en-US',
  tagged: true,
  pageCount: 30,
  bookmarks: 5,
  sampledPages: 10,
  sampledWithText: 10,
};

const statusOf = (input: A11yInput, id: string): string | undefined =>
  evaluateAccessibility(input).find((c) => c.id === id)?.status;

describe('accessibility checks', () => {
  it('passes a well-formed document', () => {
    expect(evaluateAccessibility(good).every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails a document with no title, language or structure tree', () => {
    const bare = { ...good, title: '  ', language: '', tagged: false };
    expect(statusOf(bare, 'title')).toBe('fail');
    expect(statusOf(bare, 'language')).toBe('fail');
    expect(statusOf(bare, 'tagged')).toBe('fail');
  });

  it('warns about a long document without bookmarks, but not a short one', () => {
    expect(statusOf({ ...good, bookmarks: 0 }, 'bookmarks')).toBe('warn');
    expect(statusOf({ ...good, bookmarks: 0, pageCount: 3 }, 'bookmarks')).toBe('pass');
  });

  it('fails a scanned document where no sampled page has text', () => {
    expect(statusOf({ ...good, sampledWithText: 0 }, 'text')).toBe('fail');
    expect(statusOf({ ...good, sampledWithText: 5 }, 'text')).toBe('warn');
  });
});
