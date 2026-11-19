import { describe, expect, it } from 'vitest';
import { applyNamingRule, sanitizeFileName } from './naming';

const date = new Date(2026, 0, 5, 9, 7);
const ctx = { name: 'Invoice.pdf', op: 'clean', index: 3, date };

describe('file naming rules', () => {
  it('fills name and operation tokens', () => {
    expect(applyNamingRule('{name}-{op}', ctx)).toBe('Invoice-clean.pdf');
  });

  it('pads counters and formats the date', () => {
    expect(applyNamingRule('{date}_{index:4}_{name}', ctx)).toBe('2026-01-05_0003_Invoice.pdf');
  });

  it('removes characters that are not allowed in file names', () => {
    expect(applyNamingRule('{name}:{time}', ctx)).toBe('Invoice-09-07.pdf');
    expect(sanitizeFileName('a/b\\c*d?')).toBe('a-b-c-d-');
  });

  it('falls back to the original name when the rule is empty', () => {
    expect(applyNamingRule('', ctx)).toBe('Invoice.pdf');
  });
});
