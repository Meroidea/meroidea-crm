import { expect, test } from '@playwright/test';

import { PLATFORM_OWNER_STATE } from './support/accounts';
import { onboardBusiness } from './support/flows';

test('switching a feature on for a running business tells its admin on the dashboard', async ({
  page,
  context,
  browser,
}, testInfo) => {
  // Onboards a business, then opens the console in a second browser as the platform owner.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company } = await onboardBusiness(page, context, stamp);
  const notice = page.getByRole('status').filter({ hasText: 'Now switched on' });
  await expect(notice).toHaveCount(0);

  // The platform owner, in their own browser, switches two more features on.
  const consoleContext = await browser.newContext({ storageState: PLATFORM_OWNER_STATE });
  const consolePage = await consoleContext.newPage();
  await consolePage.goto('/platform');
  await expect(consolePage).toHaveURL(/\/platform$/, { timeout: 30_000 });
  await consolePage.getByRole('link', { name: company }).click();
  await consolePage.waitForLoadState('networkidle');
  await consolePage.getByRole('checkbox', { name: /^Invoices/ }).check();
  await consolePage.getByRole('checkbox', { name: /^Projects/ }).check();
  // The button is disabled while saving too, so wait for the save itself to come back.
  const saved = consolePage.waitForResponse(
    (response) => response.request().method() === 'POST' && response.ok(),
    { timeout: 30_000 },
  );
  await consolePage.getByRole('button', { name: 'Save features' }).click();
  await saved;
  // The console says who was told; there is no email provider in tests, so it says that too.
  await expect(
    consolePage.getByText(
      'Features saved. Their Admin has been told in their workspace, but the email could not be sent',
    ),
  ).toBeVisible({ timeout: 30_000 });
  await consolePage.reload();
  await expect(consolePage.getByRole('checkbox', { name: /^Invoices/ })).toBeChecked();
  await consoleContext.close();

  // The business's admin sees what is new and where to give their own roles access.
  await page.goto('/dashboard');
  await expect(notice).toContainText('Now switched on: Projects, Invoices');
  await expect(notice).toContainText('Settings → Roles');
  await expect(notice.getByRole('button', { name: 'Review role access' })).toBeVisible();

  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(notice).toHaveCount(0);
});
