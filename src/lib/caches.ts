// Shared in-memory caches. Their capacity adapts to the machine: low-memory computers get smaller caps (see desktop.ts).
import { LRU } from './util';

export const thumbCache = new LRU<string, string>(600);

export function setThumbCacheLimit(n: number): void {
  thumbCache.setMax(n);
}
