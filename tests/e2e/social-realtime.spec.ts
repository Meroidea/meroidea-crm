import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { PLATFORM_OWNER_STATE } from './support/accounts';
import { onboardBusiness } from './support/flows';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test('a new customer message appears in the open conversation without reloading', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.slow();
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const { company } = await onboardBusiness(page, context, stamp, 'retail');

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

  // A connected account and a conversation, as the webhook would have stored them; no Meta app
  // exists in tests, so they are written straight to the database.
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const [tenant] = await sql`select id from tenants where name = ${company}`;
    const tenantId = tenant!.id as string;
    const [account] = await sql`
      insert into social_accounts (tenant_id, platform, external_id, name)
      values (${tenantId}, 'facebook', ${`page-${stamp}`}, 'Corner Store') returning id`;
    const [conversation] = await sql`
      insert into social_conversations (tenant_id, account_id, participant_id, participant_name,
        last_message_at, last_message_preview, last_inbound_at)
      values (${tenantId}, ${account!.id}, ${`psid-${stamp}`}, 'Riley Realtime', now(),
        'Do you sell stamps?', now()) returning id`;
    await sql`
      insert into social_messages (tenant_id, conversation_id, account_id, external_id, direction,
        body, sent_at)
      values (${tenantId}, ${conversation!.id}, ${account!.id}, ${`m1-${stamp}`}, 'inbound',
        'Do you sell stamps?', now())`;

    await page.goto(`/social/${conversation!.id}`);
    await expect(page.getByRole('heading', { name: 'Riley Realtime' })).toBeVisible();
    await expect(page.getByText('Do you sell stamps?').last()).toBeVisible();
    // The private Realtime channel is joined (Realtime Authorization with the person's session).
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 });

    await sql`
      insert into social_messages (tenant_id, conversation_id, account_id, external_id, direction,
        body, sent_at)
      values (${tenantId}, ${conversation!.id}, ${account!.id}, ${`m2-${stamp}`}, 'inbound',
        'And envelopes?', now())`;
    // Well inside the 30-second fallback refresh: this arrives over the WebSocket.
    await expect(
      page.getByRole('list', { name: 'Messages' }).getByText('And envelopes?'),
    ).toBeVisible({
      timeout: 8_000,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, 'the conversation scrolls sideways').toBe(false);
  } finally {
    await sql.end();
  }
});
