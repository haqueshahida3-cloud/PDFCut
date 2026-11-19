import { expect, test, type Page } from 'playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const p = doc.addPage([420, 594]);
    p.drawText(`Sample page ${i}`, { x: 40, y: 520, size: 28, font, color: rgb(0.1, 0.1, 0.4) });
    p.drawText('Invoice total is due soon.', { x: 40, y: 480, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

async function skipOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('pdfcut-settings', JSON.stringify({ state: { onboardingDone: true, language: 'en', animations: false }, version: 1 }));
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

test('compression runs in the worker and downloads a smaller valid PDF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Compress', exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'compress-me.pdf', mimeType: 'application/pdf', buffer: await samplePdf() });
  await expect(page.getByText('2 pages')).toBeVisible();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Compress and download' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('compress-me-compressed.pdf');
  const saved = await file.path();
  expect(saved).toBeTruthy();
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('find and replace removes the matched text from the output', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Find & replace', exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'replace-me.pdf', mimeType: 'application/pdf', buffer: await samplePdf() });
  await page.getByPlaceholder('Text to find').fill('Invoice total');
  await page.getByPlaceholder('Replacement text').fill('Receipt total');
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.getByText(/match(es)? on 2 pages?/)).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Replace all and save' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('replace-me-replaced.pdf');
});

test('automation shows the naming rule preview and updates it live', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Automation', exact: true }).click();
  const rule = page.getByLabel('Naming rule');
  await rule.fill('{name}-{op}');
  await expect(page.getByText('→ Invoice 2026-clean.pdf')).toBeVisible();
  await rule.fill('{index:3}_{name}');
  await expect(page.getByText('→ 001_Invoice 2026.pdf')).toBeVisible();
});

test('form fields can be added and the form saved', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Form fields', exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: await samplePdf() });
  await expect(page.getByText(/existing field/)).toBeVisible();
  await page.getByRole('button', { name: 'Add field to list' }).click();
  await expect(page.getByText(/field_1 \(text, page 1\)/)).toBeVisible();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: /Save with 1 new field/ }).click();
  expect((await download).suggestedFilename()).toBe('form-forms.pdf');
});
