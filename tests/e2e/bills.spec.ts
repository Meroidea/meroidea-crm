import { expect, test } from '@playwright/test';

import { onboardBusiness, switchOnFeature } from './support/flows';

test('a supplier bill is entered, flagged when entered twice, part paid, and shows what is owed', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company } = await onboardBusiness(page, context, stamp, 'retail');
  await switchOnFeature(browser, company, /^Bookkeeping/);

  await page.goto('/books');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Set up the books' }).click();
  await expect(page.getByRole('status')).toContainText('Your books are set up', {
    timeout: 30_000,
  });

  const enter = async () => {
    await page.goto('/books/bills/new');
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox', { name: 'Supplier', exact: true }).fill('Harbour Properties');
    await page.getByLabel('Their invoice number').fill('HP-1001');
    await page.getByRole('combobox', { name: 'Account' }).selectOption({ label: '469 · Rent' });
    await page.getByLabel('Amount', { exact: true }).fill('1100');
    await expect(page.getByText('Bill total')).toBeVisible();
    await page.getByRole('button', { name: 'Enter bill' }).click();
  };

  await enter();
  await expect(page).toHaveURL(/\/books\/bills\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Harbour Properties' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'GST on Expenses ($100.00)' })).toBeVisible();

  // The same supplier invoice number again is flagged before anything is saved.
  await enter();
  await expect(page.getByRole('alert').filter({ hasText: 'already entered' })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto('/books/bills');

  // Pay $400 of it.
  await page
    .getByRole('link', { name: /Harbour Properties/ })
    .first()
    .click();
  const section = page.locator('section').filter({ hasText: 'Payments and credits' });
  await section.getByLabel('Amount', { exact: true }).fill('400');
  await section.getByRole('button', { name: 'Record payment' }).click();
  await expect(section.getByText(/^Still owed/)).toContainText('$700.00', { timeout: 30_000 });

  // The books know: accounts payable is what is still owed.
  await page.goto('/books');
  await expect(page.getByText('You owe suppliers').locator('..').locator('..')).toContainText(
    '$700.00',
  );

  for (const path of ['/books/bills', '/books/bills/new', '/books/bills/pay']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `${path} scrolls sideways`).toBe(false);
  }
});
