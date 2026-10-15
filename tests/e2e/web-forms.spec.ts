import { expect, test } from '@playwright/test';

import { onboardBusiness } from './support/flows';

/*
 * docs/leads.md §3.1: the business's admin builds a website form, adds a question of their own,
 * previews and publishes it; a visitor's answers arrive as a new lead.
 */

test('an admin builds and publishes a website form, and a visitor’s enquiry becomes a lead', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp, 'consultancy');

  await page.goto('/settings?tab=forms');
  await page.getByRole('link', { name: 'New form' }).click();
  await expect(page).toHaveURL(/\/settings\/forms\/new$/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Form name (for your team)').fill('Free consultation');
  await page.getByLabel('Heading on the page').fill('Book a free consultation');

  // A question of the business's own, required, plus a standard field.
  await page.getByRole('button', { name: 'New question' }).click();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill(`Study level ${stamp}`);
  await page.getByLabel('Answer type').selectOption({ label: 'Choose one' });
  await page.getByLabel('Choices, one per line').fill('Bachelor\nMaster');
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByRole('checkbox', { name: `Required: Study level ${stamp}` }).check();
  await page.getByLabel('Add a field').selectOption({ label: 'Company' });

  // The preview shows the form as visitors will see it, and cannot be sent.
  await expect(page.getByRole('heading', { name: 'Book a free consultation' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: `Study level ${stamp}` })).toBeVisible();

  await page.getByRole('button', { name: 'Save and publish' }).click();
  await expect(page).toHaveURL(/\/settings\/forms\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText('Published', { exact: true })).toBeVisible({ timeout: 30_000 });
  const link = await page.getByRole('link', { name: /\/f\// }).getAttribute('href');
  expect(link).toBeTruthy();

  // A visitor, signed in to nothing, fills the published form.
  const visitor = await browser.newContext();
  const form = await visitor.newPage();
  await form.goto(new URL(link!).pathname);
  await expect(form.getByRole('heading', { name: 'Book a free consultation' })).toBeVisible();
  await form.getByRole('textbox', { name: /^First name/ }).fill('Kiran');
  await form.getByRole('textbox', { name: /^Last name/ }).fill(`Visitor ${stamp}`);
  await form.getByRole('textbox', { name: /^Email/ }).fill(`kiran-${stamp}@example.com`);
  await form.getByRole('button', { name: 'Send enquiry' }).click();
  // The required question of their own is enforced.
  await expect(form.getByText(`Study level ${stamp} is required`)).toBeVisible();
  await form
    .getByRole('combobox', { name: new RegExp(`^Study level ${stamp}`) })
    .selectOption({ label: 'Master' });
  await form.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(form.getByText('Thank you')).toBeVisible({ timeout: 30_000 });
  await visitor.close();

  // The lead arrives in the queue, unassigned (no routing rules), with the answer on its record.
  await page.goto('/leads?view=all');
  await page
    .getByRole('link', { name: new RegExp(`Kiran Visitor ${stamp}`) })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText('Master').filter({ visible: true }).first()).toBeVisible();
});
