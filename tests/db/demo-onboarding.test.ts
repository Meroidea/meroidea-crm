import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AwardRateSchedule } from '@/modules/hiring/award-rates';

// Read once and cached by the server code, so it is set before anything imports it.
const PLATFORM_OWNER = vi.hoisted(() => {
  const email = 'platform-owner.demo-onboarding@example.com';
  process.env.PLATFORM_ADMIN_EMAILS = email;
  return email;
});

/*
 * The Fair Work pay database is the one thing mocked, at its module boundary: the scripts must
 * never guess a rate, and this suite has no API key. The figures are illustrative only.
 */
const fwc = vi.hoisted(() => {
  const classifications: Record<string, { ref: string; label: string; hourly: string }[]> = {
    MA000119: [
      {
        ref: '4548',
        label: 'Adult: Level 1 — Food and beverage attendant grade 1; Kitchen attendant grade 1',
        hourly: '26.44',
      },
      {
        ref: '4552',
        label:
          'Adult: Level 2 — Cook grade 1; Food and beverage attendant grade 2; Kitchen attendant grade 2',
        hourly: '27.47',
      },
      {
        ref: '4560',
        label:
          'Adult: Level 3 — Cook grade 2; Food and beverage attendant grade 3; Kitchen attendant grade 3',
        hourly: '28.24',
      },
      {
        ref: '4566',
        label:
          'Adult: Level 4 — Food and beverage attendant grade 4 (tradesperson); Cook grade 3 (tradesperson); Clerical grade 3; Storeperson grade 3',
        hourly: '29.45',
      },
      { ref: '4570', label: 'Adult: Level 5 — Cook grade 4 (tradesperson)', hourly: '31.32' },
      { ref: '4574', label: 'Adult: Level 6 — Cook grade 5 (tradesperson)', hourly: '32.27' },
      { ref: '88331', label: 'Junior: Introductory Level — 19 years of age', hourly: '21.88' },
    ],
    MA000002: [
      { ref: '98', label: 'Adult: Level 1—Year 1', hourly: '26.98' },
      { ref: '99', label: 'Adult: Level 1—Year 2', hourly: '28.24' },
      { ref: '100', label: 'Adult: Level 1—Year 3', hourly: '28.75' },
      { ref: '101', label: 'Adult: Level 2—Year 1', hourly: '29.33' },
      { ref: '102', label: 'Adult: Level 2—Year 2', hourly: '29.71' },
      { ref: '103', label: 'Adult: Level 3', hourly: '30.47' },
      { ref: '104', label: 'Adult: Level 4', hourly: '31.47' },
      { ref: '105', label: 'Adult: Level 5', hourly: '32.86' },
    ],
  };
  const awards = [
    { code: 'MA000119', name: 'Restaurant Industry Award 2020' },
    { code: 'MA000002', name: 'Clerks—Private Sector Award 2020' },
  ];
  return { classifications, awards, configured: { value: true } };
});

vi.mock('@/server/fair-work', () => {
  const find = (code: string, ref: string) =>
    fwc.classifications[code]?.find((option) => option.ref === ref) ?? null;
  return {
    isFairWorkConfigured: () => fwc.configured.value,
    searchAwards: async (name: string) =>
      fwc.awards.filter((award) => award.name.toLowerCase().includes(name.toLowerCase())),
    listClassifications: async (code: string) =>
      (fwc.classifications[code] ?? []).map(({ ref, label }) => ({ ref, label })),
    getMinimumRate: async (code: string, ref: string) => {
      const row = find(code, ref);
      return row ? { hourly: row.hourly, weekly: null, operativeFrom: '2026-07-01' } : null;
    },
    getAwardRates: async (
      code: string,
      ref: string,
      employment: AwardRateSchedule['employment'],
    ): Promise<AwardRateSchedule | null> => {
      const row = find(code, ref);
      if (!row) return null;
      const cents = Math.round(Number(row.hourly) * 100);
      const minimum = employment === 'casual' ? Math.round(cents * 1.25) : cents;
      return {
        awardCode: code,
        classificationRef: ref,
        employment,
        employeeKind: 'adult',
        baseHourly: row.hourly,
        baseWeekly: null,
        minimumHourly: (minimum / 100).toFixed(2),
        minimumBasis: 'Test figures.',
        groups: [],
        dayRates: null,
        allowances: [],
        operativeFrom: '2026-07-01',
        fetchedOn: '2026-10-21',
      };
    },
  };
});

import { acceptAgreementSchema } from '@/modules/platform/schemas';
import { acceptAgreement } from '@/modules/platform/agreement-public';
import { startSupportAccess } from '@/modules/platform/service';
import { adminDb } from '@/server/db/admin';
import { readObject, writeObject } from '@/server/storage';
import { createSupabaseAdminClient } from '@/server/supabase/admin';
import {
  BURWOOD_CONSULTANCY,
  DEMO_BUSINESSES,
  SYDNEY_CAFE,
  plusAlias,
} from '../../scripts/demo/data';
import { captureOfferLinks, hireStaff, payAbove, StopError } from '../../scripts/demo/hire-staff';
import { findPlatformAdmin, listAuthUsers, nextMonday } from '../../scripts/demo/lib';
import { onboardBusinesses } from '../../scripts/demo/onboard-businesses';
import { resetBusinesses, type ExportFile } from '../../scripts/demo/reset-businesses';
import { addMember, createAuthUser, createWorkspace } from '../support/workspaces';

const supabase = createSupabaseAdminClient();
const db = adminDb();
const stamp = Date.now();
const outDir = join(tmpdir(), `meroidea-demo-test-${stamp}`);
const demoNames = DEMO_BUSINESSES.map((business) => business.companyName);
const demoEmails = DEMO_BUSINESSES.map((business) => business.adminEmail);
let ownerCreated = false;

const count = async (query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { n: number }[])[0]?.n ?? -1;

async function removeDemoBusinesses() {
  const present = (
    (await db.execute(sql`select name from tenants where name in ${demoNames}`)) as unknown as {
      name: string;
    }[]
  ).map((row) => row.name);
  if (present.length > 0) {
    await resetBusinesses({
      out: join(outDir, `cleanup-${randomUUID()}.json`),
      only: present,
      confirm: present,
    });
  }
  // A login left behind by an interrupted run would make onboarding refuse the admin's email.
  for (const user of await listAuthUsers()) {
    if (
      user.email &&
      (demoEmails.includes(user.email) ||
        demoEmails.some((admin) => user.email?.startsWith(`${admin.split('@')[0]}+`)))
    ) {
      await supabase.auth.admin.deleteUser(user.id);
    }
  }
}

beforeAll(async () => {
  if (!(await listAuthUsers()).some((user) => user.email === PLATFORM_OWNER)) {
    await createAuthUser(PLATFORM_OWNER, 'Platform Owner');
    ownerCreated = true;
  }
  await removeDemoBusinesses();
}, 180_000);

afterAll(async () => {
  await removeDemoBusinesses();
  if (ownerCreated) {
    const owner = (await listAuthUsers()).find((user) => user.email === PLATFORM_OWNER);
    if (owner) await supabase.auth.admin.deleteUser(owner.id);
  }
  rmSync(outDir, { recursive: true, force: true });
}, 180_000);

describe('demo scripts: pure parts', () => {
  it('pays a stated margin above the minimum, rounded up', () => {
    expect(
      payAbove({
        minimumHourly: '26.44',
        marginPercent: 5,
        payBasis: 'hourly',
        hoursPerWeek: null,
      }),
    ).toBe('27.77');
    // 32.86 × 38 × 52 = 64,931.36; + 20% = 77,917.63 → 77,918.
    expect(
      payAbove({
        minimumHourly: '32.86',
        marginPercent: 20,
        payBasis: 'annual',
        hoursPerWeek: '38',
      }),
    ).toBe('77918');
  });

  it('starts on the next Monday in Sydney', () => {
    // Wednesday 21 October 2026, Sydney time.
    expect(nextMonday(new Date('2026-10-21T01:00:00Z'))).toBe('2026-10-26');
    // A Monday morning in Sydney starts the following Monday.
    expect(nextMonday(new Date('2026-10-25T22:00:00Z'))).toBe('2026-11-02');
  });

  it('reads the offer link from the email to Resend and forwards the request unchanged', async () => {
    const token = 'A'.repeat(43);
    const forwarded: { url: string; body: unknown }[] = [];
    const original = (async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded.push({ url: String(input), body: init?.body });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const seen: string[] = [];
    const wrapped = captureOfferLinks(original, (found) => seen.push(found));
    const body = JSON.stringify({
      to: 'x@example.com',
      html: `<a href="https://app.example.com/offer/${token}">Review</a>`,
      text: 'Hi',
    });
    await wrapped('https://api.resend.com/emails', { method: 'POST', body });
    await wrapped('https://api.fwc.gov.au/api/v1/awards', { method: 'GET' });
    expect(seen).toEqual([token]);
    expect(forwarded).toEqual([
      { url: 'https://api.resend.com/emails', body },
      { url: 'https://api.fwc.gov.au/api/v1/awards', body: undefined },
    ]);
  });
});

describe('reset-businesses', () => {
  it('exports every row and file, then deletes only the confirmed businesses and their logins', async () => {
    const names = ['A', 'B', 'C'].map((letter) => `Demo Reset Throwaway ${letter} ${stamp}`);
    const seeded: { tenantId: string; ownerId: string }[] = [];
    for (const [index, name] of names.entries()) {
      seeded.push(await createWorkspace(name, `demo-reset-${index}-${stamp}@example.com`));
    }
    const [first] = seeded;
    if (!first) throw new Error('nothing seeded');
    const staffId = await addMember(
      first.tenantId,
      `demo-reset-staff-${stamp}@example.com`,
      'Reset Staff',
      'member',
    );
    const filePath = `${first.tenantId}/documents/${randomUUID()}/${randomUUID()}.pdf`;
    await writeObject(filePath, Buffer.from('%PDF-1.4 demo'), 'application/pdf');
    // The platform owner's support seat is deleted with the business, but their login never is.
    const admin = await findPlatformAdmin();
    await startSupportAccess(admin, first.tenantId);

    const out = join(outDir, 'reset.json');
    const dry = await resetBusinesses({ out, only: names });
    expect(dry).toMatchObject({ done: false, reason: 'dry_run' });
    expect(existsSync(out)).toBe(false);

    const wrong = await resetBusinesses({ out, only: names, confirm: names.slice(0, 2) });
    expect(wrong).toMatchObject({ done: false, reason: 'confirm_mismatch' });
    expect(await count(sql`select count(*)::int as n from tenants where name in ${names}`)).toBe(3);

    const result = await resetBusinesses({ out, only: names, confirm: names });
    if (!result.done) throw new Error(`reset did not run: ${result.reason}`);
    expect(result.deletedFiles).toBe(1);
    expect(result.deletedLogins).toBe(4);
    expect(result.keptLogins).toBe(1);

    const exported = JSON.parse(readFileSync(out, 'utf8')) as ExportFile;
    expect(exported.tenants.map((entry) => entry.tenant.name).sort()).toEqual([...names].sort());
    const firstExport = exported.tenants.find((entry) => entry.tenant.id === first.tenantId);
    expect(firstExport?.tables.tenant_memberships).toHaveLength(3);
    expect(firstExport?.tables.roles?.length).toBeGreaterThan(0);
    expect(firstExport?.users.map((user) => user.id)).toContain(staffId);
    expect(firstExport?.storageObjects).toHaveLength(1);
    expect(existsSync(join(result.filesDir, 'documents', filePath))).toBe(true);

    expect(await count(sql`select count(*)::int as n from tenants where name in ${names}`)).toBe(0);
    expect(await readObject(filePath)).toBeNull();
    expect((await supabase.auth.admin.getUserById(staffId)).data.user).toBeNull();
    expect((await supabase.auth.admin.getUserById(admin.userId)).data.user?.id).toBe(admin.userId);
  }, 180_000);
});

describe('onboard-businesses then hire-staff', () => {
  it('onboards both businesses, hires 11 people into each once their admin accepts, and is idempotent', async () => {
    const admin = await findPlatformAdmin();
    expect(admin.email).toBe(PLATFORM_OWNER);

    const onboarded = await onboardBusinesses({ admin });
    expect(onboarded.map((outcome) => outcome.status)).toEqual(['created', 'created']);
    expect((await onboardBusinesses({ admin })).map((outcome) => outcome.status)).toEqual([
      'skipped',
      'skipped',
    ]);

    const businesses = (await db.execute(sql`
      select name, industry, status, business_number, features from tenants
      where name in ${demoNames} order by name`)) as unknown as {
      name: string;
      industry: string;
      status: string;
      business_number: string;
      features: string[];
    }[];
    expect(businesses).toMatchObject([
      {
        name: BURWOOD_CONSULTANCY.companyName,
        industry: 'consultancy',
        status: 'awaiting_agreement',
        business_number: '18 123 456 789',
      },
      {
        name: SYDNEY_CAFE.companyName,
        industry: 'restaurant',
        status: 'awaiting_agreement',
        business_number: '51 824 753 556',
      },
    ]);

    // Before the admins accept, nothing is hired.
    const early = await hireStaff({ admin, startDate: '2026-10-26' });
    expect(early.map((outcome) => outcome.status)).toEqual([
      'awaiting_agreement',
      'awaiting_agreement',
    ]);

    // Without the pay database, the script stops rather than guess a rate.
    fwc.configured.value = false;
    await expect(hireStaff({ admin })).rejects.toBeInstanceOf(StopError);
    fwc.configured.value = true;

    // The human step: each admin accepts the agreement from the link (handed over, no email here).
    for (const outcome of onboarded) {
      if (outcome.status !== 'created' || outcome.delivery.emailed) throw new Error('no link');
      const token = outcome.delivery.link.split('/agreement/')[1];
      await acceptAgreement(
        acceptAgreementSchema.parse({ token, fullName: 'Sujan Darji', agree: true }),
        {
          ip: null,
          userAgent: 'vitest',
        },
      );
    }

    const lines: string[] = [];
    const hired = await hireStaff({
      admin,
      startDate: '2026-10-26',
      log: (line) => lines.push(line),
    });
    // What the script prints: set DEMO_TEST_LOG=1 to see it.
    if (process.env.DEMO_TEST_LOG) console.log(lines.join('\n'));
    expect(
      lines.filter((line) => line.endsWith('contract NOT emailed (email not set up); accepted.')),
    ).toHaveLength(22);
    expect(lines.join('\n')).not.toMatch(/\/offer\//);
    for (const outcome of hired) {
      if (outcome.status !== 'done') throw new Error(`${outcome.business}: ${outcome.status}`);
      expect(outcome.hires).toHaveLength(11);
      expect(
        outcome.hires.every((hire) => hire.status === 'hired' && hire.contractEmailed === false),
      ).toBe(true);
    }

    for (const business of DEMO_BUSINESSES) {
      const [tenant] = (await db.execute(
        sql`select id from tenants where name = ${business.companyName}`,
      )) as unknown as { id: string }[];
      const tenantId = tenant?.id ?? '';
      const memberships = (await db.execute(sql`
        select r.key, count(*)::int as n from tenant_memberships m join roles r on r.id = m.role_id
        where m.tenant_id = ${tenantId} and m.status = 'active' and not m.is_support
        group by r.key order by r.key`)) as unknown as { key: string; n: number }[];
      expect(memberships).toEqual([
        { key: 'manager', n: 1 },
        { key: 'member', n: 10 },
        { key: 'owner', n: 1 },
      ]);
      expect(
        await count(sql`select count(*)::int as n from employees e
          join employment_contracts c on c.tenant_id = e.tenant_id and c.employee_id = e.id
          where e.tenant_id = ${tenantId} and e.status = 'active' and c.status = 'accepted'
            and c.start_date = '2026-10-26' and e.department_id is not null`),
      ).toBe(11);
      expect(
        await count(sql`select count(*)::int as n from employee_payroll_details
          where tenant_id = ${tenantId} and bank_bsb_ciphertext is not null
            and bank_account_ciphertext is not null and tax_file_number_ciphertext is null
            and bank_account_name like '% (demo data)' and super_fund_name = 'Example Super Fund (demo)'`),
      ).toBe(11);
      // The admin plus one login per hire, each linked to their staff record.
      expect(
        await count(sql`select count(distinct u.id)::int as n from auth.users u
          join tenant_memberships m on m.user_id = u.id
          where m.tenant_id = ${tenantId} and not m.is_support`),
      ).toBe(12);
      expect(
        await count(sql`select count(*)::int as n from employees e
          join tenant_memberships m on m.tenant_id = e.tenant_id and m.user_id = e.user_id
          where e.tenant_id = ${tenantId}`),
      ).toBe(11);
      expect(
        await count(sql`select count(*)::int as n from employees
          where tenant_id = ${tenantId} and email = ${plusAlias(business.adminEmail, 'x')}`),
      ).toBe(0);
      // Every contract pays at or above the minimum it recorded.
      expect(
        await count(sql`select count(*)::int as n from employment_contracts
          where tenant_id = ${tenantId} and minimum_rate is not null and pay_basis = 'hourly'
            and pay_rate < minimum_rate`),
      ).toBe(0);
    }

    const again = await hireStaff({ admin, startDate: '2026-10-26' });
    for (const outcome of again) {
      if (outcome.status !== 'done') throw new Error(outcome.status);
      expect(outcome.hires.every((hire) => hire.status === 'skipped')).toBe(true);
    }
  }, 600_000);
});
