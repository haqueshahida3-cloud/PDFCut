# PDFCut — Phase A audit

Baseline measured before this round: TypeScript strict passes, 29 unit tests pass, the source is about 9.6k lines of TypeScript, and ESLint was not configured.

Each finding is marked **fixed** (code changed and covered by a test or by a run), **partial** (improved, but the limit is stated), or **open**.

| # | Area | Finding | Status |
|---|------|---------|--------|
| 1 | Quality gate | No ESLint configuration, although the brief requires ESLint and strict TypeScript. | fixed (ESLint 9 flat config, `npm run lint`) |
| 2 | Worker rule | Compression and redaction rasterized pages on the main thread (`lib/raster.ts`, used by 3 tools). | fixed (moved to `lib/pdf/raster-core.ts`, run in the PDF worker) |
| 3 | Bundle | The pdf.js worker was inlined as base64 into the main bundle (about 1.6 MB). | fixed (served from `public/pdfjs/`) |
| 4 | Security | No Content-Security-Policy. | fixed (CSP meta tag in `index.html`) |
| 5 | Offline | OCR fetched English language data from a CDN at runtime. | fixed (`public/ocr/lang/eng.traineddata.gz`). Other languages still download once. |
| 6 | Performance | Reading position was written to localStorage on every scroll tick. | fixed (write only when the page changes) |
| 7 | Storage | Every opened PDF was copied into IndexedDB regardless of size. | fixed (150 MB cap; larger files are listed but not reopenable) |
| 8 | Reliability | Open viewer tabs were lost when the user navigated away. | fixed (workspace tabs are restored) |
| 9 | Engine | qpdf-wasm exit handling was assumed, not verified. Emscripten can throw an exit status instead of returning it. | fixed (exit status is read from either path; covered by `qpdf.test.ts`) |
| 10 | Jobs | Failed jobs could not be retried and nothing was logged. | fixed (retry button, persisted operation history) |
| 11 | Desktop | Electron permission requests (camera, microphone, notifications) were not restricted. | fixed (deny-all handler) |
| 12 | Verification | The Electron self-test only checked the DOM, not whether a PDF page was painted. | fixed (self-test samples canvas pixels when given a PDF) |
| 13 | Redaction | Redaction was not checked after it was applied. | partial (text-layer check after apply; does not inspect images) |
| 14 | Accessibility | No automated accessibility scan. | partial (axe scan added; only the critical and serious findings are addressed in this round) |
| 15 | Feature gaps | Layers, a global annotation manager, a customizable toolbar, a GUI folder scheduler and comparison of more than two documents do not exist. | open (see the status table in the final report) |
