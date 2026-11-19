# PDFCut

A free, private, offline PDF toolkit. Your files never leave your computer: no accounts, no uploads, no ads, no watermarks, no telemetry.

PDFCut is an Electron desktop app (React, Vite, Tailwind CSS, Zustand, Framer Motion) with PDF engines that run locally: pdf-lib, pdf.js, qpdf (WebAssembly), Tesseract (OCR). Heavy work runs in Web Workers so the interface stays responsive.

---

> Feature status, verification results and open items are in [docs/STATUS.md](docs/STATUS.md).

## Install on Debian / Ubuntu (.deb)

Requirements: Debian 12+ or Ubuntu 22.04+ (amd64). Tested on Debian 12 and Ubuntu 24.04.

```bash
# 1. Get the package (built with `npm run dist`, see below)
cd ~/Downloads        # or wherever pdfcut_1.0.0_amd64.deb is

# 2. Refresh the package list, then install. Use ./ so apt reads the local file.
sudo apt update
sudo apt install ./pdfcut_1.0.0_amd64.deb

# 3. Check
pdfcut --version
pdfcut --help
```

`apt install ./file.deb` installs everything the package needs: `qpdf`, `ghostscript`, `tesseract-ocr` with English data, `poppler-utils`, and the libraries Electron requires. Do not use `dpkg -i` alone; if you do, run `sudo apt -f install` afterwards.

Then open PDFCut from the application menu (Office category), run `pdfcut` in a terminal, or right-click a PDF → **Open With → PDFCut**.

### Right-click actions (Split / Merge / Compress with PDFCut)

- **Dolphin (KDE):** added automatically by the package.
- **Nautilus (GNOME Files) and Thunar:** run once, as your user:
  ```bash
  pdfcut integrate            # adds the actions
  pdfcut integrate --remove   # removes them
  ```
  Or open PDFCut → Settings → Desktop integration → **Add right-click actions**.
  Restart Nautilus with `nautilus -q`, or Thunar with `thunar -q`.

### Uninstall

```bash
sudo apt remove pdfcut      # keeps your settings
sudo apt purge pdfcut       # also removes the package configuration
```

### Replacing an older build

If you installed an earlier `pdfcut_0.0.0_amd64.deb` (or it failed to install), remove it first, then install the new package:

```bash
sudo apt remove pdfcut
sudo apt install ./pdfcut_1.0.0_amd64.deb
```

---

## AppImage (any distribution)

```bash
chmod +x PDFCut-1.0.0.AppImage
./PDFCut-1.0.0.AppImage
```

On Ubuntu 24.04 you may need FUSE once: `sudo apt install libfuse2t64`.
The AppImage contains the app itself. The command-line features that call `qpdf`, `tesseract` or `pdftoppm` also need those tools installed on the system (`sudo apt install qpdf tesseract-ocr tesseract-ocr-eng poppler-utils`).

---

## Command line

The same binary is the command line. Commands run without opening a window:

```bash
pdfcut info input.pdf
pdfcut split input.pdf --pages 1-5 -o out.pdf
pdfcut split input.pdf --pages 1-3,8 --each        # one file per range
pdfcut split input.pdf --every 10                  # chunks of 10 pages
pdfcut merge a.pdf b.pdf c.pdf -o merged.pdf       # adds a bookmark per file
pdfcut compress input.pdf -o smaller.pdf           # lossless structure rebuild
pdfcut convert notes.txt -o notes.pdf              # text or Markdown to PDF
pdfcut protect input.pdf --user secret -o locked.pdf      # AES-256, needs qpdf
pdfcut repair broken.pdf -o fixed.pdf                     # needs qpdf
pdfcut ocr scan.pdf -l eng -o searchable.pdf              # needs poppler-utils, tesseract
pdfcut integrate                                          # right-click actions
pdfcut --help | --version
```

Open the app with files or a specific tool:

```bash
pdfcut paper.pdf                       # opens the viewer with the file
pdfcut --open-tool split paper.pdf     # opens Split with the file loaded
```

---

## Build from source

Requirements: Node.js 20 or newer, npm, and internet access the first time (Electron and electron-builder download their runtime and packaging tools).

```bash
npm install            # installs dependencies, including Electron
npm run dist           # builds the web app, bundles the CLI, creates icons, packages
```

Outputs in `release/`:

- `pdfcut_1.0.0_amd64.deb`: Debian / Ubuntu package
- `PDFCut-1.0.0.AppImage`: portable build

Smaller targets:

```bash
npm run dist:deb      # .deb only
npm run desktop       # run the Electron app from the source tree (after a build)
npm run dev           # browser-only development server (no Electron)
npm run cli -- info input.pdf   # run the CLI from source
```

### How the package is built

| Piece | Where |
| --- | --- |
| Web app (React) | `src/`, built by Vite to `dist/` |
| Command line | `src/cli/run.ts`, bundled by esbuild to `dist-electron/cli.cjs` |
| Electron main process, window, tray, IPC | `electron/main.cjs` |
| Preload bridge (`window.pdfcut`) | `electron/preload.cjs` |
| Icons (SVG → PNG sizes) | `public/icon.svg` → `build/icons/`, `electron/assets/` (`npm run icons`) |
| Packaging config (deb depends, desktop entry, file type) | `electron-builder.yml` |
| Package metadata | `package.json` (`name`, `version`, `homepage`, `author`) |

The packaged app loads the web build through the custom scheme `app://pdfcut/`, not `file://`. This is required because WebAssembly, locale files and workers do not load from `file://`. The main process serves only files inside `dist/`.

Before publishing, change the placeholders in `package.json` (`homepage`, `author`) and `electron-builder.yml` (`maintainer`, `vendor`).

---

## Features

| Area | What works |
| --- | --- |
| Viewer | Tabs, split view, scroll / single / two-page layouts, zoom, thumbnails, bookmarks, search with highlights, dark and sepia reading, presentation, auto-scroll, read-aloud, focus mode, reading-progress memory, print. Pages are virtualized and rendered lazily. |
| Split | Page ranges, every N pages, bookmarks, maximum file size, blank pages, text pattern, visual page selection. |
| Merge | Drag to reorder, page selection per file, a bookmark per file. |
| Page editor | Rotate, delete, duplicate, insert blank, split in half, crop, drag to reorder, N-up, booklet imposition, paper size. Unlimited undo and redo, autosave and crash recovery. |
| Compress | Lossless rebuild, raster presets (light / medium / strong), custom quality and resolution, target file size, before/after preview. |
| Convert | PDF to PNG / JPEG / WebP (ZIP), images to PDF, PDF to text / Markdown / HTML, text or Markdown to PDF. |
| OCR | Scanned PDFs or images to text and to a searchable PDF (invisible text layer). |
| Annotate and redact | Highlight, rectangles, ink, text, notes, drawn or typed signatures. Permanent redaction burns boxes into the page pixels. Find and redact by pattern (email, phone, card number, SSN-style IDs, custom regex). |
| Security | Metadata editor, safe-share copy, AES-256 passwords with permissions, password removal, repair, web optimization. |
| Stamp | Text watermark, page numbers, headers and footers, Bates numbering. |
| Compare | Text diff and visual diff of two PDFs. |
| Extract | All text, tables to CSV, embedded attachments, document facts. |
| Batch and workflows | Run an operation on many files with an error report. Build reusable multi-step workflows. Watch a folder (Chromium-based browsers only). |
| Desktop | Window with a custom title bar, tray icon (closing the window keeps PDFCut running), "Open with PDFCut", single instance (opening a second file adds it to the running app), save dialog for downloads, file-manager actions. |
| Settings | Light, dark, AMOLED and system themes with a night schedule. 20 accent colours and a custom theme editor (JSON import and export). Wallpapers, density, fonts, motion, performance mode, high contrast, memory limit, backup and restore. |
| Languages | 210 locale files generated from English (`npm run locales`). Native translations for English, Spanish, French, German, Arabic, Urdu, Bengali, Hindi and Simplified Chinese; other languages fall back to English. Right-to-left layout for Arabic, Urdu, Hebrew and Persian. |
| Diagnostics | Startup time, frame rate, worker and render benchmarks against targets, logs, exportable JSON report. |

## Not included yet

- RPM (Fedora, openSUSE) and pacman (Arch, Manjaro) packages. The `.deb` and AppImage are the supported Linux targets now. electron-builder can produce the others once they are needed.
- Scanner support (SANE). `libsane1` is declared as a recommended package, but the app does not use it yet.
- Digital signatures (PKCS#12 signing and verification), PDF/A conversion, form filling and form creation, link and bookmark editors, flatten forms, auto-deskew, barcode and QR separators, Office / EPUB / TIFF conversion, embedded image and font extraction.
- Ghostscript is declared as a dependency for future raster tools. The current compression runs in the app itself and does not call it.
- Keyboard shortcut remapping, tags and collections, multi-window.
- Code signing: the `.deb` and AppImage are not signed.

## Tests

```bash
npm test               # unit tests (Vitest): PDF operations, page ranges, cache, formatting
npm run test:e2e       # end-to-end tests (Playwright) against the production build
```

End-to-end tests need Chromium: `npx playwright install chromium`. On Debian or Ubuntu, also run `sudo npx playwright install-deps` once.

## Troubleshooting

**`pdfcut: command not found` after installing**
The install did not finish. Look at the output of `sudo apt install ./pdfcut_1.0.0_amd64.deb`. If it lists packages as "not installable", run `sudo apt update` and install again. Check with `dpkg -l pdfcut` and `readlink -f /usr/bin/pdfcut` (it should print `/opt/PDFCut/pdfcut`).

**`sudo dnf` or `sudo pacman` says "command not found"**
This package is for Debian and Ubuntu, which use apt. Fedora and Arch need their own package formats (see "Not included yet"). Use the AppImage there.

**`Command 'pdfcut' not found, did you mean 'pvfcut'`**
That is a different program (`mgetty-pvftools`). Install PDFCut as above; the name `pdfcut` only exists after a successful install.

**`ocr` or `protect` says a tool is not installed**
Install the tools: `sudo apt install qpdf poppler-utils tesseract-ocr tesseract-ocr-eng`.

**OCR language missing**
Install the language pack, for example `sudo apt install tesseract-ocr-ben` (Bengali) or `tesseract-ocr-ara` (Arabic). Use the same code with `-l` (`pdfcut ocr scan.pdf -l ben+eng`).

**Window does not appear, or the app closes immediately**
Start it from a terminal to see errors: `pdfcut`. The log is in `~/.config/PDFCut/logs/pdfcut.log`. Include it when reporting a problem.

**Right-click actions do not show in Nautilus or Thunar**
Run `pdfcut integrate`, then restart the file manager (`nautilus -q` or `thunar -q`). Dolphin gets them from the package directly.

**No tray icon on GNOME**
GNOME needs the AppIndicator extension (`gnome-shell-extension-appindicator`). Without a tray, closing the window quits PDFCut.

**Frameless window cannot be resized on some desktops**
Resize from the window edges, or use your window manager's keyboard resize shortcut. Maximize with the title bar button.

**AppImage does not start on Ubuntu 24.04**
Install FUSE: `sudo apt install libfuse2t64`, or run it with `./PDFCut-1.0.0.AppImage --appimage-extract-and-run`.

**`Failed to connect to the bus` messages in the terminal**
Harmless on systems without a D-Bus session. They do not stop PDFCut.

**Large files are rejected**
The memory limit is set in Settings → Motion and performance. Split very large files first, or raise the limit.
