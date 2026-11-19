import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createFields, fillFields, flattenForms, inspectForms } from './forms';
import { silentCtx } from './ops';

async function blank(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]);
  return doc.save();
}

describe('AcroForm tools', () => {
  it('creates text and checkbox fields on the requested page', async () => {
    const made = await createFields(
      await blank(2),
      [
        { type: 'text', name: 'full_name', page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.06 },
        { type: 'checkbox', name: 'agree', page: 1, x: 0.1, y: 0.2, w: 0.05, h: 0.05 },
      ],
      silentCtx,
    );
    const fields = await inspectForms(made);
    expect(fields.map((f) => [f.name, f.type, f.page])).toEqual([
      ['full_name', 'text', 1],
      ['agree', 'checkbox', 1],
    ]);
  });

  it('refuses a field name that already exists', async () => {
    const made = await createFields(await blank(), [{ type: 'text', name: 'a', page: 0, x: 0, y: 0, w: 0.2, h: 0.05 }], silentCtx);
    await expect(
      createFields(made, [{ type: 'text', name: 'a', page: 0, x: 0, y: 0.1, w: 0.2, h: 0.05 }], silentCtx),
    ).rejects.toThrow(/already exists/);
  });

  it('fills a value and flattens the form into the page', async () => {
    const made = await createFields(await blank(), [{ type: 'text', name: 'city', page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.06 }], silentCtx);
    const filled = await fillFields(made, { city: 'Dhaka' }, silentCtx);
    const [field] = await inspectForms(filled);
    expect(field.value).toBe('Dhaka');
    expect(await inspectForms(await flattenForms(filled, silentCtx))).toHaveLength(0);
  });
});
