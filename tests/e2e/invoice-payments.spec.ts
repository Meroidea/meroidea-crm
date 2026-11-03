import { expect, test } from '@playwright/test';

import { onboardBusiness } from './support/flows';

test('an invoice is paid in two parts and credited, and shows what is still owed', async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  // A retail business has invoices switched on.
  await onboardBusiness(page, context, stamp, 'retail');

  await page.goto('/invoices/new');
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Customer', exact: true }).fill('Lumen Studio');
  await page.getByLabel('Line 1 description').fill('Consulting');
  await page.getByLabel('Line 1 quantity').fill('1');
  await page.getByLabel('Line 1 price').fill('200');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Mark as sent' }).click();

  const section = page.locator('section').filter({ hasText: 'Payments and credits' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  const owed = await section.getByText(/^Still owed/).textContent();

  // Part payment of $50.
  await section.getByLabel('Amount', { exact: true }).fill('50');
  await section.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Part paid')).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText(/^Still owed/)).not.toHaveText(owed ?? '');

  // A credit note, then the rest paid with "Mark as paid".
  await section.getByText('Give a credit').click();
  await section.getByLabel('Credit, including GST').fill('10');
  await section.getByLabel('Reason').fill('Goodwill');
  await section.getByRole('button', { name: 'Issue credit note' }).click();
  await expect(section.getByText('CN-0001 · Goodwill')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(section.getByText(/^Still owed/)).toContainText('$0', { timeout: 30_000 });
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();

  // The list shows the invoice as paid; the multi-invoice payment page has nothing left to pay.
  await page.goto('/invoices/payments/new');
  await expect(page.getByText('No sent invoice is waiting for payment.')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});
