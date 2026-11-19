import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { analyzeStructure, deltaToUpright, dominantQuarter, pageSizeLabel } from './analyze';

describe('page analysis helpers', () => {
  it('names standard paper sizes in either orientation', () => {
    expect(pageSizeLabel(595.28, 841.89)).toBe('A4');
    expect(pageSizeLabel(841.89, 595.28)).toBe('A4');
    expect(pageSizeLabel(612, 792)).toBe('Letter');
    expect(pageSizeLabel(500, 500)).toMatch(/^Custom 176×176 mm$/);
  });

  it('finds the dominant text direction weighted by length', () => {
    expect(dominantQuarter([{ angle: 90, weight: 10 }, { angle: 0, weight: 2 }])).toEqual({
      quarter: 90,
      confidence: 10 / 12,
    });
    expect(dominantQuarter([])).toBeNull();
  });

  it('computes the rotation that makes text upright', () => {
    expect(deltaToUpright(0, 90)).toBe(90);
    expect(deltaToUpright(270, 90)).toBe(180);
    expect(deltaToUpright(90, 0)).toBe(270);
  });
});

describe('analyzeStructure', () => {
  it('groups pages whose content streams are identical', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const text of ['Same', 'Other', 'Same']) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(text, { x: 50, y: 700, size: 20, font });
    }
    const result = await analyzeStructure(await doc.save());
    expect(result.pageCount).toBe(3);
    expect(result.sizes).toEqual(['A4', 'A4', 'A4']);
    expect(result.groups).toEqual([[0, 2]]);
  });
});
