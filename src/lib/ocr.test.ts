// Real OCR run with the bundled English data (no network). Renders text to an image, then reads it back.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { describe, expect, it } from 'vitest';

describe('OCR engine (Tesseract, offline English data)', () => {
  it('reads large printed English text from an image', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="220">
      <rect width="100%" height="100%" fill="white"/>
      <text x="40" y="150" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="88" fill="black">PDFCUT OCR TEST</text>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const worker = await createWorker('eng', 1, {
      langPath: resolve('public/ocr/lang'),
      cachePath: mkdtempSync(join(tmpdir(), 'pdfcut-ocr-')),
      logger: () => undefined,
    });
    try {
      const { data } = await worker.recognize(png);
      expect(data.text.toUpperCase()).toContain('PDFCUT');
    } finally {
      await worker.terminate();
    }
  }, 180_000);
});
