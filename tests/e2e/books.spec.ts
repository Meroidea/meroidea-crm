import { expect, test } from '@playwright/test';

import { PLATFORM_OWNER } from './support/accounts';
import { onboardBusiness, signIn } from './support/flows';

test('an admin sets up the books, records money in, and sees it in the reports', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company } = await onboardBusiness(page, context, stamp, 'retail');

  // Bookkeeping is an add-on: the platform owner switches it on for this business.
  const consoleContext = await browser.newContext();
  const consolePage = await consoleContext.newPage();
  await signIn(consolePage, PLATFORM_OWNER.email, PLATFORM_OWNER.password);
  await expect(consolePage).toHaveURL(/\/platform$/, { timeout: 30_000 });
  await consolePage.getByRole('link', { name: company }).click();
  await consolePage.waitForLoadState('networkidle');
  await consolePage.getByRole('checkbox', { name: /^Bookkeeping/ }).check();
  const saved = consolePage.waitForResponse(
    (response) => response.request().method() === 'POST' && response.ok(),
    { timeout: 30_000 },
  );
  await consolePage.getByRole('button', { name: 'Save features' }).click();
  await saved;
  await consoleContext.close();

  // The admin sets up the Australian books.
  await page.goto('/books');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Set up your books' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up the books' }).click();
  await expect(page.getByRole('status')).toContainText('Your books are set up', {
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Books' })).toBeVisible();

  // Money in: $110 of takings including GST.
  await page.goto('/books/entries/new?kind=money_in');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('What was it for?').fill('Weekend takings');
  await page.getByRole('combobox', { name: 'Account' }).selectOption({ label: '200 · Sales' });
  await page.getByLabel('Amount', { exact: true }).fill('110');
  await expect(page.getByText('Total received')).toBeVisible();
  await page.getByRole('button', { name: 'Record money in' }).click();
  await expect(page).toHaveURL(/\/books\/entries\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Weekend takings' })).toBeVisible();

  // The accountant view shows the debits and credits behind it.
  await page.getByRole('link', { name: 'Accountant view' }).click();
  await expect(page.getByRole('cell', { name: 'GST on Income ($10.00)' })).toBeVisible();

  // Profit and Loss: $100 of sales after GST; the Balance Sheet balances.
  await page.goto('/books/reports/profit-and-loss');
  await expect(page.getByRole('row', { name: /200 Sales/ })).toContainText('$100.00');
  await expect(page.getByRole('row', { name: /Net profit/ })).toContainText('$100.00');
  await page.goto('/books/reports/balance-sheet');
  await expect(page.getByRole('row', { name: /Total assets/ })).toContainText('$110.00');
  // The sheet balances: no warning, and net assets equal total equity ($110 in the bank less
  // $10 of GST owed). Next.js's own route announcer also has role "alert", so look for ours.
  await expect(page.getByText('does not balance')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Net assets/ })).toContainText('$100.00');
  await expect(page.getByRole('row', { name: /Total equity/ })).toHaveCount(1);
  await expect(page.getByRole('row', { name: /Total equity/ })).toContainText('$100.00');
  await page.goto('/books/reports/trial-balance');
  await expect(page.getByRole('row', { name: /Totals/ })).toContainText('$110.00');

  // No books page scrolls sideways on a phone (rules/architecture.md: every screen works at 375px).
  for (const path of [
    '/books',
    '/books/entries',
    '/books/entries/new?kind=money_out',
    '/books/accounts',
    '/books/reports/profit-and-loss',
    '/books/reports/balance-sheet',
    '/books/reports/trial-balance',
    '/books/settings',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `${path} scrolls sideways`).toBe(false);
  }
});
