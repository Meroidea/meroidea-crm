import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { chromium, expect, type FullConfig } from '@playwright/test';

import {
  ensurePlatformOwner,
  ensureServiceAgreement,
  PLATFORM_OWNER,
  PLATFORM_OWNER_STATE,
} from './support/accounts';
import { signIn } from './support/flows';

export default async function globalSetup(config: FullConfig): Promise<void> {
  await ensurePlatformOwner();
  await ensureServiceAgreement();
  await signInPlatformOwner(config);
}

/**
 * Signs the platform owner in once and saves the session for every test to reuse. Each sign-in
 * counts against the per-sender limit (40 per 15 minutes), and every test comes from the same
 * address, so tests that typed the password themselves would soon be refused.
 */
async function signInPlatformOwner(config: FullConfig): Promise<void> {
  const { baseURL, launchOptions } = config.projects[0]?.use ?? {};
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ baseURL });
    await signIn(page, PLATFORM_OWNER.email, PLATFORM_OWNER.password);
    await expect(page).toHaveURL(/\/platform$/, { timeout: 60_000 });
    await mkdir(dirname(PLATFORM_OWNER_STATE), { recursive: true });
    await page.context().storageState({ path: PLATFORM_OWNER_STATE });
  } finally {
    await browser.close();
  }
}
