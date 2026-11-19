import { expect, test, type Page } from 'playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function samplePdf(pages = 4): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([420, 594]);
    p.drawText(`Sample page ${i}`, { x: 40, y: 520, size: 28, font, color: rgb(0.1, 0.1, 0.4) });
    p.drawText('PDFCut end-to-end fixture. The quick brown fox.', { x: 40, y: 480, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

/** Skips the first-run tour and pins English so assertions are stable. */
async function skipOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pdfcut-settings',
      JSON.stringify({ state: { onboardingDone: true, language: 'en', animations: false }, version: 1 }),
    );
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

test('dashboard loads with no runtime errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Split/ }).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('split a PDF by page range and download the result', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Split', exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: await samplePdf(4),
  });
  await expect(page.getByText('4 pages')).toBeVisible();
  await page.getByLabel('Pages', { exact: true }).fill('1-2');
  await expect(page.getByText('Will create 1 file')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Split PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('sample-split.pdf');
  expect(errors).toEqual([]);
});

test('viewer renders an uploaded PDF on a canvas', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Viewer' }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'viewer.pdf',
    mimeType: 'application/pdf',
    buffer: await samplePdf(3),
  });
  await expect(page.getByRole('tab', { name: /viewer\.pdf/ })).toBeVisible();
  await expect(page.locator('canvas[aria-label="Page 1"]').first()).toBeVisible({ timeout: 20_000 });
  // A blank canvas is a failure: poll until the page has visible ink on it.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement | null;
          if (!c || c.width === 0) return 0;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 0; i < d.length; i += 64) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) painted++;
          return painted;
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('command palette opens with Ctrl+K and filters tools', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox');
  await expect(search).toBeVisible();
  await search.fill('compress');
  await expect(page.getByRole('option').first()).toContainText('Compress');
  await page.keyboard.press('Escape');
});

test('theme switches to dark mode from settings', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
});

test('switching to Arabic flips the layout to right-to-left', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /العربية/ }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});
