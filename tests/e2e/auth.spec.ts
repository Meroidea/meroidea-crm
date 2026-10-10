import { expect, test, type Page } from '@playwright/test';

import { PLATFORM_OWNER } from './support/accounts';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  // The submit handler only exists once React has hydrated.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('the workspace and the platform console are closed to people who are not signed in', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  await page.goto('/platform');
  await expect(page).toHaveURL(/\/login$/);
});

test('the platform owner onboards a business, and its admin gets a workspace with only its features', async ({
  page,
  context,
}, testInfo) => {
  // Builds routes on first use, creates a login and a workspace, then signs in twice.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const company = `Harbour Cafe ${stamp}`;
  const adminEmail = `admin-${stamp}@example.com`;

  await signIn(page, PLATFORM_OWNER.email, PLATFORM_OWNER.password);
  await expect(page).toHaveURL(/\/platform$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Businesses' })).toBeVisible();

  await page.getByRole('link', { name: 'Onboard a business' }).click();
  await expect(page).toHaveURL(/\/platform\/new$/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Business name').fill(company);
  await page.getByLabel('Type of business').selectOption('restaurant');
  await page.getByLabel('Their admin’s name').fill('Robin Admin');
  await page.getByLabel('Their admin’s email').fill(adminEmail);
  await page.getByRole('button', { name: 'Create business and admin login' }).click();

  await expect(page.getByRole('heading', { name: `${company} is ready` })).toBeVisible({
    timeout: 30_000,
  });
  const handover = (await page.locator('pre').textContent()) ?? '';
  const temporaryPassword = /Temporary password: (\S+)/.exec(handover)?.[1];
  expect(temporaryPassword, 'the handover shows a temporary password').toBeTruthy();

  // Hand over: the owner leaves, the business's admin signs in for the first time.
  await context.clearCookies();
  await signIn(page, adminEmail, temporaryPassword!);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByText(company).first()).toBeVisible();

  if (testInfo.project.name === 'mobile-375') {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
  }
  // A restaurant gets rosters, but not the sales pipeline it never asked for.
  const nav = page.getByRole('navigation', { name: 'Workspace' });
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
});

test('a wrong password is refused without revealing whether the account exists', async ({
  page,
}) => {
  await signIn(page, 'nobody@example.com', 'not-the-password');
  await expect(page.locator('form').getByRole('alert')).toHaveText(/do not match/i);
  await expect(page).toHaveURL(/\/login$/);
});
