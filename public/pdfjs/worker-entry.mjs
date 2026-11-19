// Entry point for pdf.js's parser worker. The polyfill is imported first, so ES module evaluation order
// guarantees it is installed before pdf.js runs in this worker.
import './polyfill.mjs';
import './pdf.worker.min.mjs';
