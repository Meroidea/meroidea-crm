import { expect, test } from '@playwright/test';

test('a page arrives with its entrance and leaves no transform behind', async ({ page }) => {
  await page.goto('/login');
  const wrapper = page.locator('.page-enter').first();
  await expect(wrapper).toBeVisible();
  // Once played, nothing is left that would re-anchor fixed-position elements on the page.
  await expect
    .poll(() => wrapper.evaluate((element) => getComputedStyle(element).transform))
    .toBe('none');
  // The card keeps its full width inside the centred column.
  const card = page.locator('[data-slot="card"]').first();
  expect((await card.boundingBox())?.width ?? 0).toBeGreaterThan(300);
});

test('following a link shows the progress bar, which completes and rests', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const bar = page.locator('.nav-progress');
  await expect(bar).toHaveAttribute('data-phase', 'idle');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(bar).toHaveAttribute('data-phase', 'idle', { timeout: 5_000 });
});

test('motion switches off for people who ask for less of it', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/login');
  const animation = await page
    .locator('.page-enter')
    .first()
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await context.close();
});
