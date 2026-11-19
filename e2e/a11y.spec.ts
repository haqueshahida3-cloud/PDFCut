import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from 'playwright/test';

async function skipOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('pdfcut-settings', JSON.stringify({ state: { onboardingDone: true, language: 'en', animations: false }, version: 1 }));
  });
}

async function blockingViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.length} node(s) — ${v.help}`);
}

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

test('dashboard has no critical or serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('viewer has no critical or serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Viewer' }).click();
  await expect(page.getByText('Tip')).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('settings has no critical or serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});
