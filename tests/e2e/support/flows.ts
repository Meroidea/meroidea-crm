import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { PLATFORM_OWNER } from './accounts';

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  // The submit handler only exists once React has hydrated.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Opens a one-time set-your-password link and chooses a password, ending on the dashboard. */
export async function choosePassword(page: Page, password: string) {
  await expect(page).toHaveURL(/\/set-password$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Type it again').fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

/**
 * The platform owner onboards a restaurant from the console; its admin accepts the service
 * agreement from the handed-over link and chooses their password (ADR-047). Ends signed in as
 * that admin, on their dashboard. Returns the spent agreement link too.
 */
export async function onboardBusiness(
  page: Page,
  context: BrowserContext,
  stamp: string,
): Promise<{ company: string; adminEmail: string; agreementLink: string }> {
  const company = `Harbour Cafe ${stamp}`;
  const adminEmail = `admin-${stamp}@example.com`;

  await signIn(page, PLATFORM_OWNER.email, PLATFORM_OWNER.password);
  await expect(page).toHaveURL(/\/platform$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Businesses' })).toBeVisible();
  await expect(page.locator('[data-slot="dot-background"]')).toHaveCount(1);

  await page.getByRole('link', { name: 'Onboard a business' }).click();
  await expect(page).toHaveURL(/\/platform\/new$/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Business name').fill(company);
  await page.getByLabel('ABN').fill('51 824 753 556');
  await page.getByLabel('Type of business').selectOption('restaurant');
  await page.getByLabel('Name', { exact: true }).fill('Robin Admin');
  await page.getByLabel('Email', { exact: true }).fill(adminEmail);
  await page.getByLabel('Phone').fill('02 5550 1234');
  await page.getByLabel('Admin’s full name').fill('Robin Admin');
  await page.getByLabel('Admin’s email').fill(adminEmail);
  await page.getByRole('button', { name: 'Create business and send the agreement' }).click();

  await expect(page.getByRole('heading', { name: `${company} is set up` })).toBeVisible({
    timeout: 30_000,
  });
  // No email provider in tests, so the console shows the link once to pass on.
  const agreementLink = ((await page.locator('pre').textContent()) ?? '').trim();
  expect(agreementLink, 'the handover shows the agreement link').toMatch(
    /\/agreement\/[\w-]{40,50}$/,
  );

  // Hand over: the owner leaves; the business's admin opens the link from their email.
  await context.clearCookies();
  await page.goto(new URL(agreementLink).pathname);
  await expect(page.getByText('Test service agreement')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox').check();
  await page.getByLabel('Type your full name to accept').fill('Robin Admin');
  await page.getByRole('button', { name: 'Accept and choose my password' }).click();

  // Accepting signs them in once to choose their own password; nobody else ever knew it.
  await choosePassword(page, 'harbour-cafe-password-1');
  await expect(page.getByText(company).first()).toBeVisible();
  return { company, adminEmail, agreementLink };
}

/** The admin adds someone from Settings → Team and gets the password link to pass on. */
export async function addPerson(page: Page, name: string, email: string, role: string) {
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
export async function signInAs(browser: Browser, link: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await choosePassword(page, password);
  return { context, page };
}
