// pdf.js 5.x uses the ES "upsert" methods (Map/WeakMap getOrInsert and getOrInsertComputed),
// which older Chromium, Firefox and Safari builds do not provide yet. These fall back to
// equivalent implementations so rendering works everywhere the app runs.
type Upsert = (this: Map<unknown, unknown> | WeakMap<object, unknown>, key: never, arg: unknown) => unknown;

function define(proto: object, name: string, fn: Upsert): void {
  if (typeof (proto as Record<string, unknown>)[name] === 'function') return;
  Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
}

const getOrInsert: Upsert = function (this, key, value) {
  const map = this as Map<unknown, unknown>;
  if (map.has(key)) return map.get(key);
  map.set(key, value);
  return value;
};

const getOrInsertComputed: Upsert = function (this, key, callback) {
  const map = this as Map<unknown, unknown>;
  if (map.has(key)) return map.get(key);
  const value = (callback as (k: unknown) => unknown)(key);
  map.set(key, value);
  return value;
};

for (const proto of [Map.prototype, WeakMap.prototype] as object[]) {
  define(proto, 'getOrInsert', getOrInsert);
  define(proto, 'getOrInsertComputed', getOrInsertComputed);
}
