/*
 * Onboards the two example businesses exactly as the platform owner does from /platform:
 * createBusinessSchema parses the same fields the console's form sends, and createBusiness
 * creates the workspace, the admin's login (which nobody can use yet) and emails the admin the
 * one-time link to accept the service agreement.
 *
 *   npx tsx --tsconfig scripts/demo/tsconfig.json scripts/demo/onboard-businesses.ts [--as owner@x]
 *
 * A business that already exists by name is skipped. The agreement link is never printed: when
 * it could not be emailed, resend it from Platform → the business → "Resend agreement link",
 * which shows it to the platform owner, as the console always does.
 */

import { BUSINESS_TYPES } from '@/lib/features';
import { createBusinessSchema } from '@/modules/platform/schemas';
import { createBusiness, listBusinesses } from '@/modules/platform/service';
import type { PlatformAdmin } from '@/server/platform';

import { DEMO_BUSINESSES, type DemoBusiness } from './data';
import { findPlatformAdmin, isEntry, parseArgs, runMain } from './lib';

export type OnboardOutcome =
  | { name: string; status: 'skipped'; tenantId: string }
  | {
      name: string;
      status: 'created';
      tenantId: string;
      /** Present only when the email could not be sent; for tests, never printed. */
      delivery: { emailed: true } | { emailed: false; link: string };
    };

/** The console's form values for one business, with the type's preset features. */
export function consoleInput(business: DemoBusiness) {
  const type = BUSINESS_TYPES.find((candidate) => candidate.key === business.businessType);
  if (!type) throw new Error(`Unknown business type ${business.businessType}.`);
  return createBusinessSchema.parse({
    companyName: business.companyName,
    legalName: business.legalName,
    businessNumber: business.businessNumber,
    primaryContactName: business.adminName,
    primaryContactEmail: business.adminEmail,
    primaryContactPhone: business.primaryContactPhone,
    businessType: business.businessType,
    adminName: business.adminName,
    adminEmail: business.adminEmail,
    features: [...type.features],
    latitude: business.latitude,
    longitude: business.longitude,
    radiusMetres: business.radiusMetres,
  });
}

export async function onboardBusinesses(options: {
  admin: PlatformAdmin;
  businesses?: DemoBusiness[];
  log?: (line: string) => void;
}): Promise<OnboardOutcome[]> {
  const log = options.log ?? (() => {});
  const outcomes: OnboardOutcome[] = [];
  for (const business of options.businesses ?? DEMO_BUSINESSES) {
    // Parse first, so a bad ABN or coordinate stops before anything is created.
    const input = consoleInput(business);
    const existing = (await listBusinesses(options.admin)).find(
      (row) => row.name.toLowerCase() === business.companyName.toLowerCase(),
    );
    if (existing) {
      log(`- ${business.companyName}: already exists (${existing.status}), skipped.`);
      outcomes.push({ name: business.companyName, status: 'skipped', tenantId: existing.id });
      continue;
    }
    const created = await createBusiness(options.admin, input);
    const { tenantId, ...delivery } = created;
    log(
      `- ${business.companyName}: created ${tenantId} (${business.businessType}, ` +
        `${input.features.length} features, ABN ${input.businessNumber}).`,
    );
    log(
      delivery.emailed
        ? `  Agreement link emailed to the admin.`
        : `  Agreement link NOT emailed (email is not set up). Open /platform → ${business.companyName} → Resend agreement link to get it.`,
    );
    outcomes.push({
      name: business.companyName,
      status: 'created',
      tenantId,
      delivery: delivery.emailed ? { emailed: true } : { emailed: false, link: delivery.link },
    });
  }
  return outcomes;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const as = args.get('as');
  const admin = await findPlatformAdmin(typeof as === 'string' ? as : undefined);
  console.log(`Acting as platform owner ${admin.email}.`);
  await onboardBusinesses({ admin, log: (line) => console.log(line) });
  console.log(
    '\nNext: each admin opens the emailed link, accepts the service agreement and chooses a ' +
      'password. Then run hire-staff.ts.',
  );
  return 0;
}

if (isEntry('onboard-businesses.ts')) runMain(main);
