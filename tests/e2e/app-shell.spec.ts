import { expect, test } from '@playwright/test';

test('the homepage is public and offers sign in and sign up', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('run your business');
  await expect(page.getByRole('link', { name: 'Start free' }).first()).toBeVisible();

  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
});

test('the homepage shows the workspace preview and four features', async ({ page }) => {
  await page.goto('/');

  const headings = page.locator('#features').getByRole('heading', { level: 3 });
  await expect(headings).toHaveCount(4);
  await headings.last().scrollIntoViewIfNeeded();
  await expect(headings.last()).toBeVisible();
  await expect(headings.last()).toHaveCSS('opacity', '1');
});

test('public pages never scroll sideways', async ({ page }) => {
  for (const path of ['/', '/login', '/signup']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
  }
});
