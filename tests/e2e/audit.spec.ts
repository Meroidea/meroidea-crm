import { expect, test } from '@playwright/test';

import { onboardBusiness } from './support/flows';

test('an admin reads the audit log, follows one record’s history and exports it', async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp, 'retail');

  await page.goto('/audit');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  const entries = page.getByRole('main').getByRole('listitem');

  // Accepting the service agreement during onboarding is on record.
  await page.getByRole('combobox', { name: 'Action' }).selectOption({ label: 'Accepted' });
  await expect(page).toHaveURL(/action=accept/);
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText('Service agreement');

  // The history of that one record, then back to everything.
  await entries.first().getByRole('link', { name: 'History of this record' }).click();
  await expect(page).toHaveURL(/record=[0-9a-f-]{36}/);
  await expect(page.getByText('Showing the history of one service agreement')).toBeVisible();
  await page.getByRole('link', { name: 'Show all' }).click();
  await expect(page).not.toHaveURL(/record=/);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(entries.first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  expect((await download).suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);

  // The export is itself on record.
  await page.reload();
  await expect(entries.first()).toContainText('Exported');

  // Every screen works at 375px (rules/architecture.md).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow, '/audit scrolls sideways').toBe(false);
});
