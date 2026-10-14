import { expect, test } from '@playwright/test';

import { onboardBusiness, signIn } from './support/flows';

test('the workspace and the platform console are closed to people who are not signed in', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  await page.goto('/platform');
  await expect(page).toHaveURL(/\/login$/);
});

test('the platform owner onboards a business, its admin accepts the agreement and gets a workspace with only its features', async ({
  page,
  context,
}, testInfo) => {
  // Builds routes on first use, creates a login and a workspace, then signs in twice.
  test.slow();
  const { agreementLink: link } = await onboardBusiness(
    page,
    context,
    `${Date.now()}-${testInfo.project.name}`,
  );

  // The link is spent: opening it again cannot sign anyone in.
  await page.goto(new URL(link).pathname);
  await expect(page.getByText('This link is no longer valid')).toBeVisible();
  await page.goto('/dashboard');
  // The workspace sits on the same dotted background as the public site.
  await expect(page.locator('[data-slot="dot-background"]')).toHaveCount(1);

  if (testInfo.project.name === 'mobile-375') {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
  }
  // A restaurant gets rosters, but not the sales pipeline it never asked for.
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  // Pages sit inside groups that open downwards from their title.
  await nav.getByRole('button', { name: 'People' }).click();
  await expect(nav.getByText('Roster', { exact: true })).toBeVisible();
  await expect(nav.getByText('Settings', { exact: true })).toBeVisible();
  await expect(nav.getByText('Contacts', { exact: true })).toHaveCount(0);
  if (testInfo.project.name === 'mobile-375') await page.keyboard.press('Escape');

  // Its settings leave out pipeline configuration too, rather than failing to load it.
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Team' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pipeline' })).toHaveCount(0);

  // The console does not exist as far as a business's own people can tell.
  const response = await page.goto('/platform');
  expect(response?.status()).toBe(404);
  await expect(page.locator('[data-slot="dot-background"]')).toHaveCount(1);
});

test('a wrong password is refused without revealing whether the account exists', async ({
  page,
}) => {
  await signIn(page, 'nobody@example.com', 'not-the-password');
  await expect(page.locator('form').getByRole('alert')).toHaveText(/do not match/i);
  await expect(page).toHaveURL(/\/login$/);
});
