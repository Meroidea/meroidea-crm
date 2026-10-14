import { expect, test } from '@playwright/test';

import { choosePassword, onboardBusiness } from './support/flows';

test('a hire accepts their offer and gets the Staff login the admin chose for them', async ({
  page,
  context,
  browser,
}, testInfo) => {
  // Onboards a business first, then hires: two sign-ins and several first-time route builds.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company } = await onboardBusiness(page, context, stamp);
  const hireEmail = `sky-${stamp}@example.com`;

  // The admin hires someone and chooses the login they get on accepting (ADR-048).
  await page.goto('/hiring/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('First name').fill('Sky');
  await page.getByLabel('Last name').fill('Newstart');
  await page.getByLabel('Email').fill(hireEmail);
  const loginRole = page.getByLabel('Login when they accept');
  await expect(loginRole.locator('option:checked')).toHaveText('Staff');
  await expect(loginRole.locator('option')).toHaveText(['Staff', 'Manager', 'No login']);
  await page.getByText('Casual', { exact: true }).click();
  await page.getByLabel('Position').fill('Barista');
  await page.getByLabel('Start date').fill('2031-03-03');
  await page.getByLabel(/Hourly rate/).fill('35.50');
  await page.getByRole('button', { name: 'Save and review contract' }).click();

  await expect(page).toHaveURL(/\/staff\/[0-9a-f-]{36}\?section=contract$/, { timeout: 30_000 });
  const staffUrl = page.url();
  await page.getByRole('button', { name: 'Send for acceptance' }).click();
  const offerLink = await page.getByLabel('One-time link').inputValue();
  expect(offerLink).toMatch(/\/offer\/[\w-]{40,50}$/);

  // The new hire opens their offer in their own browser and accepts it.
  const hireContext = await browser.newContext();
  const hirePage = await hireContext.newPage();
  await hirePage.goto(new URL(offerLink).pathname);
  await hirePage.waitForLoadState('networkidle');
  for (const box of await hirePage.getByRole('checkbox').all()) await box.check();
  await hirePage.getByLabel('Type your full name to accept').fill('Sky Newstart');
  await hirePage.getByRole('button', { name: 'Accept offer' }).click();
  await expect(hirePage.getByText(`You have a login for ${company}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(hirePage.getByText(hireEmail).first()).toBeVisible();

  // Their login is in the admin's team list as Staff, linked to their staff record.
  await page.goto('/settings?tab=team');
  const row = page.getByRole('listitem').filter({ hasText: hireEmail });
  await expect(row.getByRole('combobox').locator('option:checked')).toHaveText('Staff');

  // No email in tests, so the admin passes on a password link; the hire chooses their password
  // and lands in the workspace as Staff, without the admin's menus.
  await row.getByRole('button', { name: 'Password link' }).click();
  const passwordLink = await page.getByLabel('Password link').inputValue();
  await hirePage.goto(new URL(passwordLink).pathname + new URL(passwordLink).search);
  await choosePassword(hirePage, 'sky-newstart-password-1');
  await expect(hirePage.getByText(company).first()).toBeVisible();
  await hirePage.goto('/settings');
  await expect(hirePage.getByRole('heading', { level: 1, name: 'Settings' })).toHaveCount(0);

  // The staff record is linked to that login, so there is no login left to give.
  await page.goto(staffUrl.replace('section=contract', 'section=personal'));
  await expect(page.getByRole('heading', { name: 'Employment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Give them a login' })).toHaveCount(0);
  await hireContext.close();
});
