import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { processFolderOnce, type FolderOptions, type FolderResult } from './folder';

async function samplePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText(text, { x: 20, y: 200, size: 20 });
  return doc.save();
}

const statusOf = (results: FolderResult[], file: string): string | undefined => results.find((r) => r.file === file)?.status;

describe('folder processing', () => {
  it('processes new files once, skips duplicates, and records failures separately', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfcut-folder-'));
    writeFileSync(join(dir, 'a.pdf'), await samplePdf('alpha'));
    writeFileSync(join(dir, 'a-copy.pdf'), await samplePdf('alpha'));
    writeFileSync(join(dir, 'broken.pdf'), 'not a pdf');
    const opts: FolderOptions = { op: 'clean', naming: '{name}-{op}', skipDuplicates: true };

    const first = await processFolderOnce(dir, opts, new Date(2026, 0, 1));
    expect(first.map((r) => r.status).sort()).toEqual(['done', 'duplicate', 'failed']);
    expect(existsSync(join(dir, 'failed', 'broken.pdf.error.txt'))).toBe(true);
    expect(readdirSync(join(dir, 'processed'))).toHaveLength(1);

    const second = await processFolderOnce(dir, opts, new Date(2026, 0, 1));
    expect(statusOf(second, 'a-copy.pdf')).toBe('skipped');
    expect(statusOf(second, 'a.pdf')).toBe('duplicate');
    expect(statusOf(second, 'broken.pdf')).toBe('failed');
    expect(readdirSync(join(dir, 'processed'))).toHaveLength(1);
  }, 120_000);

  it('splits every N pages into numbered parts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfcut-split-'));
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage([200, 200]);
    writeFileSync(join(dir, 'five.pdf'), await doc.save());
    const results = await processFolderOnce(dir, { op: 'split', every: 2, naming: '{name}', skipDuplicates: true });
    expect(results[0].outputs).toHaveLength(3);
    expect(readdirSync(join(dir, 'processed')).sort()).toEqual(['five-part-001.pdf', 'five-part-002.pdf', 'five-part-003.pdf']);
  }, 120_000);
});
