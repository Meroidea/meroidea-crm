import { expect, test } from '@playwright/test';

test('the workspace is closed to people who are not signed in', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});

test('signing up provisions a workspace and lands in it', async ({ page }, testInfo) => {
  // Compiles the route, signs up, provisions a workspace and signs out again.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const company = `Kestrel Freight ${stamp}`;

  await page.goto('/signup');
  // The submit handler only exists once React has hydrated.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Your name').fill('Jordan Blake');
  await page.getByLabel('Company name').fill(company);
  await page.getByLabel('Work email').fill(`owner-${stamp}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-staple-42');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(company).first()).toBeVisible();

  // Navigation is composed from the owner's grants and uses the neutral default labels.
  if (testInfo.project.name === 'mobile-375') {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
  }
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await expect(nav.getByText('Contacts', { exact: true })).toBeVisible();
  await expect(nav.getByText('Settings', { exact: true })).toBeVisible();

  if (testInfo.project.name === 'mobile-375') {
    // The sheet overlays the header, so close it before reaching the sign-out control.
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
  }

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
});

test('a wrong password is refused without revealing whether the account exists', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.locator('form').getByRole('alert')).toHaveText(/do not match/i);
  await expect(page).toHaveURL(/\/login$/);
});
