# PDFCut — feature status and verification

This page records what is built, how it was checked, and what is still open. "Verified" means a test or a run in
this repository produced the result. "Implemented" means the code exists but has no automated test yet.

## Quality gates

| Gate | Result |
|------|--------|
| TypeScript (strict) | `npm run typecheck` passes |
| ESLint 9 | 0 errors, 14 warnings (React Compiler hook rules, tracked, see `eslint.config.js`) |
| Unit and engine tests (Vitest) | 264 passing, including real OCR, qpdf WebAssembly encryption, and all 210 locale files |
| End-to-end tests (Playwright, Chromium) | 13 passing: compression, find & replace, automation, form fields, dashboard, viewer, command palette, theme, RTL, and axe scans of dashboard, viewer and settings |
| Production build | `npm run build` passes (`dist/index.html` about 2.5 MB) |
| Packages | `npm run dist` produces `release/pdfcut_1.0.0_amd64.deb` and `release/PDFCut-1.0.0.AppImage` |
| Installed package (Debian 12 test host) | Installed with `apt install ./…deb`; headless CLI works without a display; GUI opens a PDF and paints pixels; uninstall leaves no launcher link or AppArmor profile |

## Phase results

### A. Audit
See `docs/AUDIT.md`: 15 findings, each marked fixed, partial or open.

### B. Engine reliability and critical bugs
- Content-Security-Policy in `index.html` — verified (e2e flows run with no console errors).
- pdf.js parser moved out of the bundle; runs in its own worker with a `Map.getOrInsertComputed` polyfill — verified.
- Compression, redaction and find-and-replace rasterize inside the PDF worker — verified (compression and replace e2e download tests).
- Redaction check: text-layer verification after apply — implemented, not covered by an automated test. It does not inspect rasterized pixels.
- OCR works offline with bundled English data — verified by a real recognition test.
- qpdf (WebAssembly): encrypt, decrypt, wrong-password rejection, linearize — verified.
- Job retry for failed jobs and an operation history — implemented; retry works only for failures from the current session.
- Viewer tabs are restored after navigation — implemented, not covered by an automated test.
- Recent files: bytes are stored only up to 150 MB — implemented.

### C. UI/UX
- Status bar (view, background tasks, offline badge, performance mode, heap, language) — verified in a screenshot.
- Floating selection panel in the page editor — implemented.
- Dark workspace palette and darker muted text for WCAG AA contrast — verified by the axe contrast rule on the dashboard.
- Sidebar: visual refinements only. A full premium-sidebar redesign is not done.

### D. Performance for 4 GB RAM systems
- Low-memory detection: machines with 4.5 GB or less get smaller caches, and performance mode is turned on at first run — verified in the sandbox (performance mode shown in the status bar).
- Measured: about 750 MB RSS across 7 Electron processes with one PDF open. Not measured on real 4 GB hardware.

### E. Document management and automation
- Duplicate pages (identical content streams; font and image resources compared) — verified by unit test.
- Page sizes (standard names, otherwise millimetres) — verified by unit test.
- Blank pages (visual check) and auto-orientation from text direction — helpers verified; UI actions implemented, not covered by e2e.
- Page labels (numbering shown by viewers) — implemented, not unit-tested.
- Find & replace: matches inside single text runs, affected pages become image-only — scan verified in e2e; replacement download verified in e2e.
- Form fields: create text and checkbox fields, fill, flatten — verified by unit tests and an e2e flow.
- Accessibility checker: rules verified by unit tests; the UI card is implemented, not e2e-tested.
- Naming rules with live preview — verified by unit test and e2e.
- Duplicate-file detection by SHA-256 — implemented.
- Scheduled folder processing: `pdfcut watch <folder>` (interval or `--once`), with duplicate skipping and a failed folder — verified by unit test and a headless run.
- Scheduling inside the desktop window — not done. Use the CLI with cron or a systemd timer.

### F. Localization and accessibility
- 210 locale files are complete for every English key and have correct RTL flags — verified by test.
- axe (WCAG 2.0/2.1 A and AA) on dashboard, viewer and settings: no critical or serious violations — verified.
- Full WCAG conformance is not verified. Other screens have not been scanned yet.

### G. Security, testing and Linux integration
- Electron permission requests denied — implemented.
- Desktop self-test checks that a PDF is painted (`PDFCUT_SELFTEST` with `PDFCUT_SELFTEST_PDF`) — verified.
- `/usr/bin/pdfcut` is a launcher: command-line tasks run Electron as Node (`ELECTRON_RUN_AS_NODE`), so no display is needed — verified on the test host with `DISPLAY` unset.
- Right-click actions for Nautilus, Thunar and Dolphin are installed by `pdfcut integrate` — verified for the file contents only, not in a running file manager.

### H. Final build
- `npm install`, `npm run build` and `npm run dist` — verified on the test host (Debian 12).
- Not yet verified on Ubuntu 24.04. The package declares the Ubuntu `t64` library names.

## Not included in this round

- Layers and a global annotation manager (annotation list across pages).
- Customizable toolbar.
- Comparing more than two documents at once.
- A scheduler inside the desktop window.
- Digital signatures (PKCS#12 signing and verification), PDF/A, form filling in the viewer, scanner (SANE) support.
- Word, Excel, PowerPoint, EPUB and TIFF conversion; editing existing text in place.
- Near-duplicate page detection (only identical content is detected).
- Offline OCR for languages other than English (they download once from the Tesseract data CDN).
- Keyboard shortcut remapping, multi-window.
- Measured performance on 4 GB hardware and on Ubuntu 24.04.
