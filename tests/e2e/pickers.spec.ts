import { expect, test } from '@playwright/test';

import { onboardBusiness } from './support/flows';

test('a contact is found by searching the picker, however many there are', async ({
  page,
  context,
}, testInfo) => {
  // Onboards a business with the sales features, adds a contact, then opens a deal for them.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp, 'services');

  await page.goto('/contacts/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Add as a lead to qualify').uncheck();
  await page.getByLabel('First name').fill('Zelda');
  await page.getByLabel('Last name').fill(`Picker ${stamp}`);
  await page.getByRole('button', { name: /^Create / }).click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await page.goto('/opportunities/new');
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Picker deal');
  const picker = page.getByRole('combobox', { name: 'Contact' });
  await picker.click();
  await picker.fill('Zeld');
  await page.getByRole('option', { name: new RegExp(`Zelda Picker ${stamp}`) }).click();
  await expect(picker).toHaveValue(`Zelda Picker ${stamp}`);
  await page.getByRole('button', { name: /^Create / }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText(`Zelda Picker ${stamp}`).first()).toBeVisible();
});
