import { expect, test } from '@playwright/test';

import { addPerson, onboardBusiness, signInAs } from './support/flows';

/*
 * docs/leads.md: a B2B lead is captured by an SDR with its source and sub-source, handed to a
 * sales rep, and accepted into an account and an opportunity; a B2C lead converts directly.
 */

test('a B2B lead goes from the SDR to a sales rep, who accepts it into an opportunity', async ({
  page,
  context,
  browser,
}, testInfo) => {
  // Onboards a business, adds two people and signs in three times.
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp, 'consultancy');
  const sdrLink = await addPerson(page, 'Sam Sdr', `sam-${stamp}@example.com`, 'Staff');
  const repLink = await addPerson(page, 'Riley Rep', `riley-${stamp}@example.com`, 'Staff');
  const company = `Northwind ${stamp}`;

  // The SDR adds the lead: business, source and sub-source required.
  const sdr = await signInAs(browser, sdrLink, 'sam-sdr-password-1');
  await sdr.page.goto('/contacts/new');
  await sdr.page.waitForLoadState('networkidle');
  await sdr.page
    .getByRole('combobox', { name: 'Selling to', exact: true })
    .selectOption({ label: 'Business (B2B)' });
  await sdr.page.getByRole('textbox', { name: 'First name', exact: true }).fill('Avery');
  await sdr.page.getByRole('textbox', { name: 'Last name', exact: true }).fill('Buyer');
  await sdr.page.getByRole('textbox', { name: 'Company', exact: true }).fill(company);
  await sdr.page
    .getByRole('textbox', { name: 'Job title', exact: true })
    .fill('Operations manager');
  await sdr.page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(`avery-${stamp}@example.com`);
  await sdr.page
    .getByRole('combobox', { name: 'Source', exact: true })
    .selectOption({ label: 'Marketing' });
  await sdr.page
    .getByRole('combobox', { name: 'Sub-source', exact: true })
    .selectOption({ label: 'Digital campaign – Meta ads' });
  await sdr.page.getByRole('textbox', { name: 'Interested in', exact: true }).fill('Annual plan');
  await sdr.page.getByRole('button', { name: 'Add lead' }).click();
  await expect(sdr.page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const leadPath = new URL(sdr.page.url()).pathname;
  await expect(
    sdr.page.getByText('Marketing – Digital campaign – Meta ads').filter({ visible: true }).first(),
  ).toBeVisible();

  // Handed over to the rep with a summary; it waits for their answer.
  await sdr.page.getByRole('button', { name: 'Hand over' }).click();
  const handover = sdr.page.getByRole('dialog');
  await handover.getByLabel('Sales rep').selectOption({ label: 'Riley Rep' });
  await handover.getByLabel('Handover summary').fill('Budget approved; wants a demo next week.');
  await handover.getByRole('button', { name: 'Hand over' }).click();
  await expect(sdr.page.getByText('Pending acceptance').first()).toBeVisible({ timeout: 30_000 });

  // The rep sees it among their own and accepts it: an account and an opportunity are made.
  const rep = await signInAs(browser, repLink, 'riley-rep-password-1');
  await rep.page.goto('/leads');
  await expect(rep.page.getByText('Avery Buyer').filter({ visible: true }).first()).toBeVisible();
  await rep.page.goto(leadPath);
  await rep.page.waitForLoadState('networkidle');
  await rep.page.getByRole('button', { name: 'Accept' }).click();
  const accept = rep.page.getByRole('dialog');
  await expect(accept.getByLabel('Name', { exact: true })).toHaveValue(company);
  await accept.getByRole('button', { name: 'Accept' }).click();
  await expect(rep.page.getByText('Accepted').first()).toBeVisible({ timeout: 30_000 });

  await rep.page.goto('/opportunities');
  await expect(
    rep.page.getByText(`${company} – Annual plan`).filter({ visible: true }).first(),
  ).toBeVisible();
  await rep.page.goto('/organizations');
  await expect(rep.page.getByText(company).filter({ visible: true }).first()).toBeVisible();

  await sdr.context.close();
  await rep.context.close();
});

test('a B2C lead converts straight into an opportunity', async ({ page, context }, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  await onboardBusiness(page, context, stamp, 'consultancy');

  await page.goto('/contacts/new');
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('combobox', { name: 'Selling to', exact: true })
    .selectOption({ label: 'Individual (B2C)' });
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Jordan');
  await page.getByRole('textbox', { name: 'Last name', exact: true }).fill('Walker');
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(`jordan-${stamp}@example.com`);
  await page
    .getByRole('combobox', { name: 'Source', exact: true })
    .selectOption({ label: 'Walk-in' });
  await page
    .getByRole('combobox', { name: 'Sub-source', exact: true })
    .selectOption({ label: 'Walk-in' });
  await page.getByRole('button', { name: 'Add lead' }).click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByRole('link', { name: /Jordan Walker/ }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.goto('/opportunities');
  await expect(page.getByText('Jordan Walker').filter({ visible: true }).first()).toBeVisible();

  // The lead shows in the lead report under its source.
  await page.goto('/reports/leads');
  await expect(page.getByRole('heading', { name: 'Lead reports' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Walk-in' }).first()).toBeVisible();
});
