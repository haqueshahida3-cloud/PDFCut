// pdf.js 5.x uses Map/WeakMap getOrInsert and getOrInsertComputed (ES "upsert" proposal), which older
// Chromium, Firefox and Safari builds lack. This module adds equivalent methods. It is loaded before pdf.js
// in its parser worker (see worker-entry.mjs), and src/polyfills.ts provides the same methods in the app.
function define(proto, name, fn) {
  if (typeof proto[name] === 'function') return;
  Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
}

function getOrInsert(key, value) {
  if (this.has(key)) return this.get(key);
  this.set(key, value);
  return value;
}

function getOrInsertComputed(key, callback) {
  if (this.has(key)) return this.get(key);
  const value = callback(key);
  this.set(key, value);
  return value;
}

for (const proto of [Map.prototype, WeakMap.prototype]) {
  define(proto, 'getOrInsert', getOrInsert);
  define(proto, 'getOrInsertComputed', getOrInsertComputed);
}
