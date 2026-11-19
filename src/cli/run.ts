// PDFCut command line. It is bundled into dist-electron/cli.cjs and run by the packaged app's
// /usr/bin/pdfcut launcher when the arguments ask for a command, so no window opens.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { everyN, loadPdf, mergeFiles, rebuildPdf, silentCtx, splitGroups, textToPdf } from '../lib/pdf/ops';
import { parseRangeParts, parseRanges, stripExt } from '../lib/util';
import { processFolderOnce, startFolderWatch, type FolderOp, type FolderResult } from './folder';

export { processFolderOnce, startFolderWatch } from './folder';
export type { FolderOptions, FolderResult } from './folder';

export interface CliOptions {
  version?: string;
}

const BIN = '/usr/bin/pdfcut';

const USAGE = `PDFCut ${'{version}'} — command line

  pdfcut                                  open the app
  pdfcut <file.pdf> ...                   open files in the app
  pdfcut --open-tool split|merge|compress [files]   open a tool (file-manager actions use this)

  pdfcut info <file.pdf>
  pdfcut split <file.pdf> --pages 1-5 [--each] [-o out.pdf]
  pdfcut split <file.pdf> --every 10 [-o out.pdf]
  pdfcut merge <a.pdf> <b.pdf> ... -o merged.pdf
  pdfcut compress <file.pdf> [-o out.pdf]            lossless structure rebuild
  pdfcut convert <file.txt|file.md> [-o out.pdf]     text to PDF
  pdfcut protect <file.pdf> --user PW [--owner PW] [-o out.pdf]   AES-256 (needs qpdf)
  pdfcut repair <file.pdf> [-o out.pdf]              (needs qpdf)
  pdfcut ocr <file.pdf> [-l eng] [-o out.pdf]        (needs poppler-utils and tesseract-ocr)
  pdfcut watch <folder> [--op rebuild|clean|split] [--every N] [--interval 300] [--once] [--naming "{name}-{op}"] [--allow-duplicates]
  pdfcut integrate [--remove]                        add right-click actions for Nautilus, Thunar, Dolphin

  pdfcut --help | --version
`;

type Flags = Record<string, string>;

function parseArgs(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) {
      const key = a.replace(/^-+/, '');
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else flags[key] = 'true';
    } else pos.push(a);
  }
  return { pos, flags };
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`missing ${what}. Run "pdfcut --help" for usage.`);
  return value;
}

function external(bin: string, args: string[], help: string): void {
  try {
    execFileSync(bin, args, { stdio: 'pipe' });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`"${bin}" is not installed. ${help}`);
    throw new Error(`${bin} failed: ${(e as Error).message}`);
  }
}

function outPath(flags: Flags, fallback: string): string {
  return resolve(flags.o ?? flags.output ?? fallback);
}

function partPath(base: string, i: number): string {
  return base.replace(/\.pdf$/i, '') + `-part-${String(i + 1).padStart(3, '0')}.pdf`;
}

// ---------- File-manager integration (per user, no root needed) ----------

const ACTIONS = [
  { tool: 'split', label: 'Split with PDFCut', multi: false },
  { tool: 'merge', label: 'Merge with PDFCut', multi: true },
  { tool: 'compress', label: 'Compress with PDFCut', multi: false },
];

function removeIfExists(file: string): boolean {
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/** Installs (or removes) right-click actions for Nautilus, Thunar and Dolphin. Returns status lines. */
export function integrateFileManagers(remove = false): string[] {
  const home = homedir();
  const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config');
  const lines: string[] = [];

  // Nautilus (GNOME Files): right-click → Scripts → "Split with PDFCut"
  const nautilusDir = join(dataHome, 'nautilus', 'scripts');
  for (const a of ACTIONS) {
    const file = join(nautilusDir, a.label);
    if (remove) {
      if (removeIfExists(file)) lines.push(`Removed Nautilus action: ${a.label}`);
      continue;
    }
    mkdirSync(nautilusDir, { recursive: true });
    writeFileSync(
      file,
      `#!/bin/sh\n# Installed by PDFCut\nset -f\nIFS='\n'\nset -- $NAUTILUS_SCRIPT_SELECTED_FILE_PATHS\nexec ${BIN} --open-tool ${a.tool} "$@"\n`,
    );
    chmodSync(file, 0o755);
    lines.push(`Nautilus: ${a.label}`);
  }

  // Thunar: uca.xml custom actions
  const uca = join(configHome, 'Thunar', 'uca.xml');
  let xml = existsSync(uca) ? readFileSync(uca, 'utf8') : '<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n</actions>\n';
  const before = xml;
  xml = xml.replace(/<action>(?:(?!<\/action>)[\s\S])*<unique-id>pdfcut-[\s\S]*?<\/action>\s*/g, '');
  if (!remove) {
    const blocks = ACTIONS.map(
      (a) =>
        `<action>\n    <icon>pdfcut</icon>\n    <name>${a.label}</name>\n    <unique-id>pdfcut-${a.tool}</unique-id>\n    <command>${BIN} --open-tool ${a.tool} ${a.multi ? '%F' : '%f'}</command>\n    <description>Open with PDFCut</description>\n    <patterns>*.pdf;*.PDF</patterns>\n    <other-files/>\n</action>`,
    ).join('\n');
    xml = xml.replace('</actions>', `${blocks}\n</actions>`);
    mkdirSync(dirname(uca), { recursive: true });
    writeFileSync(uca, xml);
    lines.push('Thunar: actions added');
  } else if (xml !== before) {
    writeFileSync(uca, xml);
    lines.push('Removed Thunar actions');
  }

  // Dolphin (KDE): service menu
  const kio = join(dataHome, 'kio', 'servicemenus', 'pdfcut.desktop');
  if (remove) {
    if (removeIfExists(kio)) lines.push('Removed Dolphin actions');
  } else {
    mkdirSync(dirname(kio), { recursive: true });
    const sections = ACTIONS.map(
      (a) => `[Desktop Action ${a.tool}]\nName=${a.label}\nIcon=pdfcut\nExec=${BIN} --open-tool ${a.tool} ${a.multi ? '%F' : '%f'}\n`,
    ).join('\n');
    writeFileSync(
      kio,
      `[Desktop Entry]\nType=Service\nServiceTypes=KonqPopupMenu/Plugin\nMimeType=application/pdf;\nActions=split;merge;compress;\nX-KDE-Priority=TopLevel\nIcon=pdfcut\n\n${sections}`,
    );
    lines.push('Dolphin: actions added');
  }
  if (lines.length === 0) lines.push('Nothing to change');
  return lines;
}

// ---------- Commands ----------

export async function runCli(argv: string[], opts: CliOptions = {}): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE.replace('{version}', opts.version ?? ''));
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    console.log(opts.version ?? 'unknown');
    return 0;
  }
  const { pos, flags } = parseArgs(rest);
  if (flags.help) {
    console.log(USAGE.replace('{version}', opts.version ?? ''));
    return 0;
  }
  try {
    switch (cmd) {
      case 'info': {
        const input = resolve(need(pos[0], 'input file'));
        const doc = await loadPdf(readFileSync(input));
        console.log(JSON.stringify({ file: basename(input), pages: doc.getPageCount(), title: doc.getTitle() ?? null }, null, 2));
        return 0;
      }
      case 'split': {
        const input = resolve(need(pos[0], 'input file'));
        const bytes = readFileSync(input);
        const total = (await loadPdf(bytes)).getPageCount();
        let groups: number[][];
        if (flags.every) groups = everyN(total, Number(flags.every));
        else if (flags.pages) {
          const parts = parseRangeParts(flags.pages, total);
          groups = flags.each ? parts : [parseRanges(flags.pages, total)];
        } else throw new Error('split needs --pages or --every');
        const out = outPath(flags, join(dirname(input), `${stripExt(basename(input))}-split.pdf`));
        const parts = await splitGroups(bytes, groups, silentCtx);
        if (parts.length === 1) writeFileSync(out, parts[0]);
        else parts.forEach((p, i) => writeFileSync(partPath(out, i), p));
        console.log(`Wrote ${parts.length} file(s)`);
        return 0;
      }
      case 'merge': {
        if (pos.length < 2) throw new Error('merge needs at least two input files');
        const inputs = pos.map((p) => ({ bytes: readFileSync(resolve(p)), name: basename(p), bookmark: true }));
        const out = outPath(flags, 'merged.pdf');
        writeFileSync(out, await mergeFiles(inputs, silentCtx));
        console.log(`Merged ${inputs.length} files → ${out}`);
        return 0;
      }
      case 'compress': {
        const input = resolve(need(pos[0], 'input file'));
        const out = outPath(flags, join(dirname(input), `${stripExt(basename(input))}-compressed.pdf`));
        const before = readFileSync(input).length;
        const after = await rebuildPdf(readFileSync(input), silentCtx);
        writeFileSync(out, after);
        console.log(`${before} → ${after.length} bytes (lossless). The app offers stronger raster compression.`);
        return 0;
      }
      case 'convert': {
        const input = resolve(need(pos[0], 'input file'));
        if (!['.txt', '.md'].includes(extname(input).toLowerCase())) throw new Error('convert supports .txt and .md input');
        const out = outPath(flags, join(dirname(input), `${stripExt(basename(input))}.pdf`));
        writeFileSync(out, await textToPdf(readFileSync(input, 'utf8'), { font: 'Helvetica', size: 11, paper: 'a4' }, silentCtx));
        console.log(`Created ${out}`);
        return 0;
      }
      case 'protect': {
        const input = resolve(need(pos[0], 'input file'));
        const user = flags.user ?? '';
        const owner = flags.owner ?? user;
        const out = outPath(flags, join(dirname(input), `${stripExt(basename(input))}-protected.pdf`));
        external('qpdf', ['--encrypt', user, owner, '256', '--', input, out], 'Install it with: sudo apt install qpdf');
        console.log(`Encrypted with AES-256 → ${out}`);
        return 0;
      }
      case 'repair': {
        const input = resolve(need(pos[0], 'input file'));
        const out = outPath(flags, join(dirname(input), `${stripExt(basename(input))}-repaired.pdf`));
        external('qpdf', [input, out], 'Install it with: sudo apt install qpdf');
        console.log(`Repaired → ${out}`);
        return 0;
      }
      case 'ocr': {
        const input = resolve(need(pos[0], 'input file'));
        const lang = flags.l ?? flags.lang ?? 'eng';
        const out = outPath(flags, join(dirname(input), `${stripExt(basename(input))}-searchable.pdf`));
        const tmp = mkdtempSync(join(tmpdir(), 'pdfcut-ocr-'));
        try {
          external('pdftoppm', ['-r', '200', '-png', input, join(tmp, 'page')], 'Install it with: sudo apt install poppler-utils');
          const images = readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
          const parts: Uint8Array[] = [];
          images.forEach((png, i) => {
            const base = join(tmp, `ocr-${i}`);
            external('tesseract', [join(tmp, png), base, '-l', lang, 'pdf'], 'Install it with: sudo apt install tesseract-ocr tesseract-ocr-eng');
            parts.push(readFileSync(`${base}.pdf`));
          });
          writeFileSync(out, await mergeFiles(parts.map((b, i) => ({ bytes: b, name: `page-${i + 1}.pdf` })), silentCtx));
          console.log(`Searchable PDF → ${out}`);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
        return 0;
      }
      case 'watch': {
        const dir = resolve(need(pos[0], 'folder'));
        const op = (flags.op ?? 'clean') as FolderOp;
        if (!['rebuild', 'clean', 'split'].includes(op)) throw new Error('--op must be rebuild, clean or split');
        const opts = {
          op,
          every: flags.every ? Number(flags.every) : undefined,
          naming: flags.naming ?? '{name}-{op}',
          skipDuplicates: !flags['allow-duplicates'],
        };
        const print = (results: FolderResult[]): void => {
          for (const r of results) {
            if (r.status === 'skipped') continue;
            console.log(`${new Date().toISOString()}  ${r.status.padEnd(9)} ${r.file}${r.error ? `  (${r.error})` : ''}`);
          }
        };
        if (flags.once) {
          print(await processFolderOnce(dir, opts));
          return 0;
        }
        const interval = Number(flags.interval ?? 300);
        console.log(`Watching ${dir} every ${interval}s. Press Ctrl+C to stop.`);
        startFolderWatch(dir, opts, interval, print);
        return 0;
      }
      case 'integrate': {
        for (const line of integrateFileManagers(Boolean(flags.remove))) console.log(line);
        return 0;
      }
      default:
        console.error(`pdfcut: unknown command "${cmd}"\n`);
        console.log(USAGE.replace('{version}', opts.version ?? ''));
        return 2;
    }
  } catch (e) {
    console.error(`pdfcut: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
