import { expect, test, type Browser, type Page } from '@playwright/test';

import { choosePassword, onboardBusiness } from './support/flows';

/** The admin adds someone from Settings → Team and gets the password link to pass on. */
async function addPerson(page: Page, name: string, email: string, role: string) {
  await page.goto('/settings?tab=team');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Add a person' }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: role });
  await page.getByRole('button', { name: 'Add and send link' }).click();
  return page.getByLabel('Password link').inputValue();
}

/** That person, in their own browser, follows the link and chooses a password. */
async function signInAs(browser: Browser, link: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await choosePassword(page, password);
  return { context, page };
}

async function raise(page: Page, raisedWith: string, about: string, title: string) {
  await page.goto('/concerns');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.getByLabel('Send to').selectOption({ label: raisedWith });
  await page.getByLabel('About').selectOption({ label: about });
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Your question').fill(`${title}: the dates, and what I think is right.`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/concerns\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url();
}

test('staff ask the admin alone about pay, and their manager never sees it', async ({
  page,
  context,
  browser,
}, testInfo) => {
  // Onboards a business, adds two people and signs in three times.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp);

  const managerLink = await addPerson(
    page,
    'Morgan Manager',
    `morgan-${stamp}@example.com`,
    'Manager',
  );
  const staffLink = await addPerson(page, 'Casey Crew', `casey-${stamp}@example.com`, 'Staff');

  const staff = await signInAs(browser, staffLink, 'casey-crew-password-1');
  const rosterTitle = 'Swap my Saturday shift';
  const payTitle = 'Hours on my last payslip';
  await raise(staff.page, 'Managers', 'Shifts and roster', rosterTitle);
  const payUrl = await raise(staff.page, 'The admin only', 'Pay and payslips', payTitle);
  await expect(staff.page.getByText('Sent to the admin only')).toBeVisible();

  // The manager sees what was raised with a manager, and nothing raised with the admin only,
  // not even by going to its address.
  const manager = await signInAs(browser, managerLink, 'morgan-manager-password-1');
  await manager.page.goto('/concerns');
  await expect(manager.page.getByText(rosterTitle)).toBeVisible();
  await expect(manager.page.getByText(payTitle)).toHaveCount(0);
  const response = await manager.page.goto(new URL(payUrl).pathname);
  expect(response?.status()).toBe(404);

  // The admin sees both and answers the one raised with them.
  await page.goto('/concerns');
  await expect(page.getByText(rosterTitle)).toBeVisible();
  await page.getByText(payTitle).click();
  await page.waitForLoadState('networkidle');
  await page
    .getByLabel('Reply')
    .fill('You are right, two hours were missed. Can we talk on Friday?');
  await page.getByRole('button', { name: 'Send reply' }).click();
  // Wait for the saved reply to show in the thread before the other person looks.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Can we talk on Friday?' }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Being looked at', { exact: true })).toBeVisible();

  // The person who raised it sees the answer.
  await staff.page.goto(new URL(payUrl).pathname);
  await expect(staff.page.getByText('Can we talk on Friday?')).toBeVisible();
  await expect(staff.page.getByText('Being looked at', { exact: true })).toBeVisible();

  await staff.context.close();
  await manager.context.close();
});
