import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { runQpdf } from './qpdf';

const WASM = resolve('public/wasm/qpdf.wasm');

async function twoPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  return doc.save();
}

describe('qpdf (WebAssembly engine)', () => {
  it('encrypts with AES-256 so the file needs a password, then decrypts it again', async () => {
    const encrypted = await runQpdf(await twoPages(), ['--encrypt', 'secret', 'secret', '256', '--'], WASM);
    await expect(PDFDocument.load(encrypted)).rejects.toThrow(/encrypted/i);
    const decrypted = await runQpdf(encrypted, ['--password=secret', '--decrypt'], WASM);
    expect((await PDFDocument.load(decrypted)).getPageCount()).toBe(2);
  }, 120_000);

  it('rejects a wrong password with a clear error', async () => {
    const encrypted = await runQpdf(await twoPages(), ['--encrypt', 'right', 'right', '256', '--'], WASM);
    await expect(runQpdf(encrypted, ['--password=wrong', '--decrypt'], WASM)).rejects.toThrow(/qpdf could not process/);
  }, 120_000);

  it('linearizes for the web without changing the page count', async () => {
    const linear = await runQpdf(await twoPages(), ['--linearize'], WASM);
    expect((await PDFDocument.load(linear)).getPageCount()).toBe(2);
  }, 120_000);
});
