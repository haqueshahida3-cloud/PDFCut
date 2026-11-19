'use strict';
// PDFCut desktop shell (Electron main process).
//  - GUI: opens the window with the web build, served from the custom scheme app://pdfcut/
//    (file:// cannot fetch WebAssembly, locale JSON or workers, so a real origin is used).
//  - CLI: `pdfcut --help`, `pdfcut split a.pdf ...` run the bundled CLI and exit without a window.
//  - "Open with PDFCut", file-manager actions (--open-tool), single instance, tray icon,
//    and a save dialog for downloads.

const path = require('node:path');
const fs = require('node:fs');
const { promisify } = require('node:util');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, session, protocol, nativeImage } = require('electron');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const CLI_PATH = path.join(__dirname, '..', 'dist-electron', 'cli.cjs');
const ASSETS = path.join(__dirname, 'assets');
const APP_ORIGIN = 'app://pdfcut';
const readFile = promisify(fs.readFile);
const startedAt = Date.now();

const CLI_COMMANDS = new Set(['info', 'split', 'merge', 'compress', 'convert', 'protect', 'repair', 'ocr', 'integrate', 'help']);
const CLI_FLAGS = new Set(['--help', '-h', '--version', '-v']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Must run before the app is ready: lets the custom scheme behave like a normal web origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

function log(message) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'pdfcut.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never crash the app.
  }
}

process.on('uncaughtException', (err) => log(`uncaught: ${err && err.stack ? err.stack : err}`));

const userArgs = process.argv.slice(app.isPackaged ? 1 : 2);
const isCli = userArgs.length > 0 && (CLI_COMMANDS.has(userArgs[0]) || userArgs.some((a) => CLI_FLAGS.has(a)));

// The entry point is at the end of this file, after every module-level `const` is initialized.

async function runCliMode(args) {
  let code = 1;
  try {
    const { runCli } = require(CLI_PATH);
    code = await runCli(args, { version: app.getVersion() });
  } catch (err) {
    process.stderr.write(`pdfcut: ${err && err.message ? err.message : err}\n`);
  }
  app.exit(code);
}

// ---------------------------------------------------------------- GUI

let mainWindow = null;
let tray = null;
let quitting = false;
let rendererReady = false;
const queued = [];
const allowedPaths = new Set();
const selfTestOutput = process.env.PDFCUT_SELFTEST || '';

function parseOpenArgs(args, cwd = process.cwd()) {
  let tool = null;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--open-tool') {
      tool = args[++i] || null;
      continue;
    }
    if (a.startsWith('--open-tool=')) {
      tool = a.slice('--open-tool='.length) || null;
      continue;
    }
    if (a.startsWith('-')) continue;
    let p = a;
    if (a.startsWith('file://')) {
      try {
        p = fileURLToPath(a);
      } catch {
        continue;
      }
    }
    const abs = path.resolve(cwd, p);
    if (/\.pdf$/i.test(abs) && fs.existsSync(abs)) paths.push(abs);
  }
  return { tool, paths };
}

function dispatch(req) {
  if (!req.tool && req.paths.length === 0) {
    showWindow();
    return;
  }
  for (const p of req.paths) allowedPaths.add(p);
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:open-request', req);
  } else {
    queued.push(req);
  }
  showWindow();
}

function showWindow() {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false, // the app draws its own title bar (drag area + window buttons)
    backgroundColor: '#f4f5f9',
    autoHideMenuBar: true,
    title: 'PDFCut',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow && mainWindow.webContents.send('win:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow && mainWindow.webContents.send('win:maximized', false));
  mainWindow.on('close', (event) => {
    // With a tray icon, closing the window keeps PDFCut running in the background.
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => log(`load failed: ${code} ${desc}`));
  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip('PDFCut');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open PDFCut', click: () => showWindow() },
        { type: 'separator' },
        { label: 'Split PDF', click: () => dispatch({ tool: 'split', paths: [] }) },
        { label: 'Merge PDFs', click: () => dispatch({ tool: 'merge', paths: [] }) },
        { label: 'Compress PDF', click: () => dispatch({ tool: 'compress', paths: [] }) },
        { type: 'separator' },
        {
          label: 'Quit PDFCut',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => showWindow());
  } catch (err) {
    log(`tray unavailable: ${err.message}`);
    tray = null;
  }
}

/** Serves files from dist/ for app://pdfcut/<path>. Anything outside dist/ is refused. */
async function serveApp(request) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(DIST_DIR, rel);
  if (!file.startsWith(DIST_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function registerIpc() {
  ipcMain.handle('app:launch', () => {
    rendererReady = true;
    return queued.splice(0);
  });
  ipcMain.handle('fs:read', async (_event, filePath) => {
    if (!allowedPaths.has(filePath)) throw new Error('This file was not opened with PDFCut.');
    return readFile(filePath);
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    totalMemMB: Math.round(os.totalmem() / 1048576),
    cpus: os.cpus().length,
  }));
  ipcMain.handle('shell:integrate', () => require(CLI_PATH).integrateFileManagers(false));
  ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('win:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('win:close', () => mainWindow && mainWindow.close());
  ipcMain.handle('win:is-maximized', () => Boolean(mainWindow && mainWindow.isMaximized()));
}

function installDownloads() {
  // Downloads ask where to save, instead of silently filling ~/Downloads.
  session.defaultSession.on('will-download', (event, item) => {
    const owner = BrowserWindow.getFocusedWindow() || mainWindow || undefined;
    const target = dialog.showSaveDialogSync(owner, {
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    if (!target) {
      item.cancel();
      return;
    }
    item.setSavePath(target);
  });
}

function runSelfTest() {
  // PDFCUT_SELFTEST=/path/shot.png: load the app, save a screenshot, report, and exit.
  // Used to verify an installed package actually starts and renders.
  const wc = mainWindow.webContents;
  wc.on('console-message', (_event, ...args) => {
    const d = args[0] && typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (Number(d.level) >= 2) process.stdout.write(`CONSOLE ${d.message} ${d.sourceId || ''}:${d.lineNumber || ''}\n`);
  });
  wc.on('render-process-gone', (_event, details) => process.stdout.write(`RENDERER GONE ${JSON.stringify(details)}\n`));
  wc.once('did-finish-load', () => {
    setTimeout(async () => {
      const guard = setTimeout(() => {
        process.stdout.write(`SELFTEST TIMEOUT loading=${wc.isLoading()} url=${wc.getURL()} crashed=${wc.isCrashed()}\n`);
        app.exit(4);
      }, 15000);
      try {
        const info = await mainWindow.webContents.executeJavaScript(
          `({ bridge: !!(window.pdfcut && window.pdfcut.isElectron), title: document.title, text: document.body.innerText.slice(0, 120), painted: (() => { const c = document.querySelector('canvas[aria-label^="Page"]'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 64) { if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) n++; } return n; })(), desktop: document.documentElement.dataset.desktop || null })`,
        );
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(selfTestOutput, image.toPNG());
        const wantsPdf = Boolean(process.env.PDFCUT_SELFTEST_PDF);
        const ok = info.bridge && info.desktop === 'true' && info.text.length > 0 && (!wantsPdf || info.painted > 0);
        process.stdout.write(`SELFTEST ${ok ? 'OK' : 'FAILED'} ${JSON.stringify({ ...info, startupMs: Date.now() - startedAt })}\n`);
        app.exit(ok ? 0 : 2);
      } catch (err) {
        process.stdout.write(`SELFTEST FAILED ${err.message}\n`);
        app.exit(3);
      }
    }, 6000);
  });
}

function startGui(args) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const initial = parseOpenArgs(args);
  if (initial.tool || initial.paths.length) {
    for (const p of initial.paths) allowedPaths.add(p);
    queued.push(initial);
  }

  app.on('second-instance', (_event, argv, cwd) => {
    dispatch(parseOpenArgs(argv.slice(app.isPackaged ? 1 : 2), cwd));
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
    });
  });

  app.whenReady().then(() => {
    app.setName('PDFCut');
    try {
      app.setDesktopName('pdfcut.desktop');
    } catch {
      // Not supported on every Linux desktop; harmless.
    }
    // The app never needs camera, microphone, notifications or geolocation: refuse every request.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle('app', serveApp);
    registerIpc();
    installDownloads();
    createWindow();
    createTray();
    if (selfTestOutput) runSelfTest();
    log(`window ready after ${Date.now() - startedAt} ms (v${app.getVersion()})`);
  });
}

// ---------------------------------------------------------------- entry point

if (isCli) {
  void runCliMode(userArgs);
} else {
  startGui(userArgs);
}
