import { expect, test } from '@playwright/test';

import { PLATFORM_OWNER_STATE } from './support/accounts';
import { onboardBusiness } from './support/flows';

test('an admin opens the social inbox and sees what can be connected', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company } = await onboardBusiness(page, context, stamp, 'retail');

  // The inbox is a feature the platform owner switches on per business (ADR-029, ADR-064).
  await page.goto('/social');
  await expect(page.getByRole('heading', { level: 1, name: 'Social inbox' })).toHaveCount(0);

  const consoleContext = await browser.newContext({ storageState: PLATFORM_OWNER_STATE });
  const consolePage = await consoleContext.newPage();
  await consolePage.goto('/platform');
  await expect(consolePage).toHaveURL(/\/platform$/, { timeout: 30_000 });
  await consolePage.getByRole('link', { name: company }).click();
  await consolePage.waitForLoadState('networkidle');
  await consolePage.getByRole('checkbox', { name: /^Social inbox/ }).check();
  const saved = consolePage.waitForResponse(
    (response) => response.request().method() === 'POST' && response.ok(),
    { timeout: 30_000 },
  );
  await consolePage.getByRole('button', { name: 'Save features' }).click();
  await saved;
  await consoleContext.close();

  await page.goto('/social');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Social inbox' })).toBeVisible();
  await expect(page.getByText('No accounts connected yet')).toBeVisible();
  // Search, and the views for one's own and snoozed conversations (ADR-067).
  await expect(page.getByRole('searchbox', { name: 'Search conversations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mine', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Snoozed', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Connect an account' }).click();
  await expect(page).toHaveURL(/\/social\/accounts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Connected accounts' })).toBeVisible();
  // Without the platform's Meta and TikTok apps set up, the business is told so plainly, and
  // Meta's WhatsApp sign-up is not loaded at all (ADR-066).
  await expect(page.getByText('Not available yet', { exact: false })).toHaveCount(3);
  await expect(page.getByText('WhatsApp', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      [...document.scripts].some((script) => script.src.includes('connect.facebook.net')),
    ),
  ).toBe(false);

  // WhatsApp templates live under Marketing, next to the inbox.
  await page.goto('/social/templates');
  await expect(page.getByRole('heading', { level: 1, name: 'WhatsApp templates' })).toBeVisible();
  await expect(page.getByText('Connect a WhatsApp number first')).toBeVisible();

  // Settings → Channels shows connection health and leads to the accounts page, with no secrets.
  await page.goto('/settings?tab=channels');
  await expect(page.getByText('No accounts connected yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect or manage accounts' })).toBeVisible();
  await expect(page.getByText(/verify token/i)).toHaveCount(0);

  // A login callback that did not start here is refused, and nothing is connected.
  await page.goto('/api/social/oauth/meta?code=forged&state=forged');
  await expect(page).toHaveURL(/\/social\/accounts\?error=expired/);
  // A production build also renders Next.js's empty route announcer with role "alert": find ours.
  await expect(
    page.getByRole('alert').filter({ hasText: 'took too long or came from another window' }),
  ).toBeVisible();

  for (const path of ['/social', '/social/accounts', '/social/templates']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `${path} scrolls sideways`).toBe(false);
  }
});
