import { describe, expect, it } from 'vitest';
import { countResidual } from './verify';

describe('residual text verification', () => {
  it('counts case-insensitive matches across pages', () => {
    expect(countResidual(['Hello world', 'hello again'], 'hello')).toBe(2);
  });

  it('respects case when asked to', () => {
    expect(countResidual(['Hello world', 'hello again'], 'Hello', true)).toBe(1);
  });

  it('treats line breaks and repeated spaces as one space', () => {
    expect(countResidual(['Hello\n   world'], 'hello world')).toBe(1);
  });

  it('returns zero for an empty needle or no matches', () => {
    expect(countResidual(['abc'], '')).toBe(0);
    expect(countResidual(['abc'], 'xyz')).toBe(0);
  });
});
