import { expect, test } from '@playwright/test';

import { onboardBusiness } from './support/flows';

test('sign-in page shows the typed password on request and leads back home', async ({ page }) => {
  await page.goto('/');
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  const password = page.getByLabel('Password', { exact: true });
  await password.fill('my-secret-words');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the account menu holds my details, password and sign out', async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp);

  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Change password' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'My details' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Phone').fill('+61 400 123 456');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(page.getByLabel('Phone')).toHaveValue('+61 400 123 456');

  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
});
