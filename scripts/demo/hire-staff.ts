/*
 * Hires 11 people into each example business through the real hiring flow, after its admin
 * has accepted the service agreement:
 *
 *   createDepartment → createHire → assignDepartment → sendContract (emailed for real)
 *   → acceptOffer (creates their login and emails their "choose your password" link, ADR-048)
 *   → submitPayrollDetails (clearly synthetic, encrypted at rest)
 *
 * in the order the offer page calls them. Every input is parsed with the schema the matching
 * action uses. Pay comes from the Fair Work pay database through the app's own client; without
 * FWC_API_KEY the script stops rather than guess a rate.
 *
 *   npx tsx --tsconfig scripts/demo/tsconfig.json scripts/demo/hire-staff.ts [--as owner@x]
 *     [--only "Sydney Cafe & Restaurant"]
 *
 * To accept each offer automatically while the contract email still goes out unchanged, the
 * script watches its own outgoing requests to Resend for the offer link. Links, tokens and
 * email contents are never printed.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { employees, roles, tenantMemberships } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { acceptOffer, submitPayrollDetails } from '@/modules/hiring/public';
import {
  acceptOfferSchema,
  createHireSchema,
  payrollDetailsSchema,
} from '@/modules/hiring/schemas';
import { createHire, sendContract } from '@/modules/hiring/service';
import { listDepartments } from '@/modules/hiring/staff-queries';
import { assignDepartmentSchema, createDepartmentSchema } from '@/modules/hiring/staff-schemas';
import { assignDepartment, createDepartment } from '@/modules/hiring/staff-service';
import { listBusinesses } from '@/modules/platform/service';
import { loadTenantContext, workspaceClosedReason, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { isEmailConfigured } from '@/server/email';
import {
  getAwardRates,
  isFairWorkConfigured,
  listClassifications,
  searchAwards,
} from '@/server/fair-work';
import type { PlatformAdmin } from '@/server/platform';

import {
  AWARDS,
  DEMO_BUSINESSES,
  HIRES_BY_BUSINESS,
  demoPayroll,
  plusAlias,
  type AwardKey,
  type DemoBusiness,
  type DemoHire,
} from './data';
import { findPlatformAdmin, isEntry, nextMonday, parseArgs, runMain, splitNames } from './lib';

/* ------------------------------------------------------------------------------------------ */
/* The offer link, read from the contract email on its way to Resend.                          */

const RESEND_URL = 'https://api.resend.com/emails';
const OFFER_URL = /https?:\/\/[^\s"'<>]+\/offer\/([A-Za-z0-9_-]{40,50})/;

/**
 * Wraps a fetch so that every POST to Resend's send endpoint is read for an `/offer/<token>`
 * link, then forwarded exactly as it was. The email goes out unchanged.
 */
export function captureOfferLinks(original: typeof fetch, onToken: (token: string) => void) {
  const wrapped: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (method === 'POST' && url === RESEND_URL) {
      let body: string | null = null;
      if (typeof init?.body === 'string') body = init.body;
      else if (input instanceof Request && init?.body === undefined) {
        body = await input.clone().text();
      }
      if (body) {
        try {
          const message = JSON.parse(body) as { html?: unknown; text?: unknown };
          const found = OFFER_URL.exec(
            `${String(message.text ?? '')}\n${String(message.html ?? '')}`,
          );
          if (found?.[1]) onToken(found[1]);
        } catch {
          // Not JSON: not ours to read. Forwarded untouched below.
        }
      }
    }
    return original(input, init);
  };
  return wrapped;
}

const tokenOf = (link: string) => OFFER_URL.exec(link)?.[1] ?? null;

/* ------------------------------------------------------------------------------------------ */
/* Pay, from the Fair Work pay database.                                                       */

export class StopError extends Error {}

const toCents = (value: string): bigint => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
};
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const fromCents = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

/**
 * A stated percentage above an hourly minimum, rounded up to the cent; or, for a salary, the
 * minimum for the weekly hours over 52 weeks plus the margin, rounded up to the dollar.
 */
export function payAbove(input: {
  minimumHourly: string;
  marginPercent: number;
  payBasis: 'hourly' | 'annual';
  hoursPerWeek: string | null;
}): string {
  const margin = BigInt(100 + input.marginPercent);
  const minimum = toCents(input.minimumHourly);
  if (input.payBasis === 'hourly') return fromCents(ceilDiv(minimum * margin, 100n));
  const hundredthHours = toCents(input.hoursPerWeek ?? '38');
  const yearly = ceilDiv(minimum * 52n * hundredthHours * margin, 100n * 100n);
  return `${ceilDiv(yearly, 100n)}`;
}

type ResolvedRate = {
  awardCode: string;
  awardName: string;
  classification: string;
  classificationRef: string;
  minimumHourly: string;
};

class AwardBook {
  private awards = new Map<AwardKey, { code: string; name: string }>();
  private lists = new Map<string, { ref: string; label: string }[]>();

  private async award(key: AwardKey) {
    const cached = this.awards.get(key);
    if (cached) return cached;
    const wanted = AWARDS[key];
    const found = (await searchAwards(wanted.search)).find((award) => award.code === wanted.code);
    if (!found) {
      throw new StopError(
        `The pay database returned no current award ${wanted.code} for "${wanted.search}".`,
      );
    }
    this.awards.set(key, found);
    return found;
  }

  /**
   * The minimum for a role. Where several adult classifications match (e.g. Clerks Level 2,
   * Year 1 and Year 2), the highest minimum is used, so the pay clears every one of them.
   */
  async rate(
    key: AwardKey,
    match: RegExp,
    employment: 'full_time' | 'part_time' | 'casual',
  ): Promise<ResolvedRate> {
    const award = await this.award(key);
    let list = this.lists.get(award.code);
    if (!list) {
      list = await listClassifications(award.code);
      this.lists.set(award.code, list);
    }
    const matches = list.filter((option) => match.test(option.label));
    if (matches.length === 0) {
      throw new StopError(`No classification in ${award.code} matches ${match}.`);
    }
    let best: ResolvedRate | null = null;
    for (const option of matches) {
      const schedule = await getAwardRates(award.code, option.ref, employment);
      const minimum = schedule?.minimumHourly;
      if (!minimum) continue;
      if (!best || toCents(minimum) > toCents(best.minimumHourly)) {
        best = {
          awardCode: award.code,
          awardName: award.name,
          classification: option.label,
          classificationRef: option.ref,
          minimumHourly: minimum,
        };
      }
    }
    if (!best) {
      throw new StopError(
        `The pay database publishes no ${employment} minimum for ${award.code} ${match}.`,
      );
    }
    return best;
  }
}

/** The hire form's values for one person, parsed with the schema the hire action uses. */
async function hireInput(
  book: AwardBook,
  business: DemoBusiness,
  hire: DemoHire,
  loginRoleId: string,
  startDate: string,
) {
  const common = {
    firstName: hire.firstName,
    lastName: hire.lastName,
    email: plusAlias(business.adminEmail, hire.alias),
    phone: '',
    employmentType: hire.employmentType,
    positionTitle: hire.positionTitle,
    startDate,
    endDate: '',
    hoursPerWeek: hire.hoursPerWeek ?? '',
    payBasis: hire.payBasis,
    belowMinimumReason: '',
    contractorAbn: '',
    probationMonths: hire.employmentType === 'casual' ? '' : 6,
    loginRoleId,
  };
  if (hire.pay.kind === 'award') {
    const rate = await book.rate(hire.pay.award, hire.pay.match, hire.employmentType);
    const payRate = payAbove({
      minimumHourly: rate.minimumHourly,
      marginPercent: hire.pay.marginPercent,
      payBasis: hire.payBasis,
      hoursPerWeek: hire.hoursPerWeek,
    });
    return {
      input: createHireSchema.parse({
        ...common,
        payRate,
        awardCode: rate.awardCode,
        awardName: rate.awardName,
        classification: rate.classification,
        classificationRef: rate.classificationRef,
        minimumRate: rate.minimumHourly,
      }),
      basis: `${rate.awardCode} "${rate.classification}" minimum $${rate.minimumHourly}/h + ${hire.pay.marginPercent}%`,
    };
  }
  // Award-free: no award recorded; the salary is sized from a reference classification.
  const reference = await book.rate(
    hire.pay.reference.award,
    hire.pay.reference.match,
    'full_time',
  );
  const payRate = payAbove({
    minimumHourly: reference.minimumHourly,
    marginPercent: hire.pay.marginPercent,
    payBasis: hire.payBasis,
    hoursPerWeek: hire.hoursPerWeek,
  });
  return {
    input: createHireSchema.parse({
      ...common,
      payRate,
      awardCode: '',
      awardName: '',
      classification: '',
      classificationRef: '',
      minimumRate: '',
    }),
    basis: `award-free; reference ${reference.awardCode} "${reference.classification}" $${reference.minimumHourly}/h + ${hire.pay.marginPercent}%`,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* One business.                                                                               */

export type HireOutcome = {
  business: string;
  name: string;
  status: 'hired' | 'skipped';
  contractEmailed?: boolean;
  loginRole?: 'manager' | 'member';
  basis?: string;
  payRate?: string;
  payBasis?: 'hourly' | 'annual';
  warnings?: string[];
};

export type BusinessOutcome =
  | { business: string; status: 'not_found' | 'awaiting_agreement' | 'closed' | 'no_admin' }
  | { business: string; status: 'done'; hires: HireOutcome[] };

/** The business's own admin: its active, non-support member in the Admin (owner) role. */
async function adminOf(tenantId: string): Promise<{ userId: string } | null> {
  const [row] = await adminDb()
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
        eq(tenantMemberships.isSupport, false),
        eq(roles.key, 'owner'),
      ),
    )
    .orderBy(tenantMemberships.createdAt)
    .limit(1);
  return row ?? null;
}

async function roleIds(tenantId: string): Promise<Record<'manager' | 'member', string>> {
  const rows = await adminDb()
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), sql`${roles.key} in ('manager', 'member')`));
  const manager = rows.find((row) => row.key === 'manager')?.id;
  const member = rows.find((row) => row.key === 'member')?.id;
  if (!manager || !member) throw new StopError('The Manager or Staff role is missing.');
  return { manager, member };
}

async function hasEmployee(tenantId: string, email: string): Promise<boolean> {
  const [row] = await adminDb()
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, tenantId),
        sql`lower(${employees.email}) = ${email.toLowerCase()}`,
        isNull(employees.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function ensureDepartments(ctx: TenantContext, names: string[]) {
  const existing = await listDepartments(ctx);
  const ids = new Map(existing.map((row) => [row.name.toLowerCase(), row.id]));
  for (const name of names) {
    if (ids.has(name.toLowerCase())) continue;
    const { id } = await createDepartment(ctx, createDepartmentSchema.parse({ name }).name);
    ids.set(name.toLowerCase(), id);
  }
  return ids;
}

const SCRIPT_META = { ip: null, userAgent: 'meroidea-demo-script' };

async function hireBusiness(
  business: DemoBusiness,
  tenantId: string,
  options: {
    startDate: string;
    log: (line: string) => void;
    awaitingToken: { current: string | null };
  },
): Promise<BusinessOutcome> {
  const { log } = options;
  const admin = await adminOf(tenantId);
  if (!admin) return { business: business.companyName, status: 'no_admin' };
  // As the admin, the way the app's own tests build a signed-in person's context.
  const ctx = await loadTenantContext({ sub: admin.userId, role: 'authenticated' }, tenantId);
  if (!ctx) return { business: business.companyName, status: 'no_admin' };
  const closed = workspaceClosedReason(ctx);
  if (closed === 'awaiting_agreement') {
    log(
      `- ${business.companyName}: its admin has not accepted the service agreement yet. ` +
        'Ask them to open the emailed link and accept it, then run this again.',
    );
    return { business: business.companyName, status: 'awaiting_agreement' };
  }
  if (closed) {
    log(`- ${business.companyName}: the business is ${closed}; nothing was hired.`);
    return { business: business.companyName, status: 'closed' };
  }

  const hires = HIRES_BY_BUSINESS[business.companyName] ?? [];
  const book = new AwardBook();
  const roleId = await roleIds(tenantId);
  const departmentIds = await ensureDepartments(ctx, business.departments);
  log(`- ${business.companyName}: departments ready (${business.departments.join(', ')}).`);

  // Work out every rate before hiring anyone, so a missing classification stops a clean run.
  const prepared: {
    hire: DemoHire;
    input: ReturnType<typeof createHireSchema.parse>;
    basis: string;
  }[] = [];
  const outcomes: HireOutcome[] = [];
  for (const hire of hires) {
    const name = `${hire.firstName} ${hire.lastName}`;
    if (await hasEmployee(tenantId, plusAlias(business.adminEmail, hire.alias))) {
      log(`  · ${name}: already on staff, skipped.`);
      outcomes.push({ business: business.companyName, name, status: 'skipped' });
      continue;
    }
    prepared.push({
      hire,
      ...(await hireInput(book, business, hire, roleId[hire.login], options.startDate)),
    });
  }

  for (const { hire, input, basis } of prepared) {
    const name = `${hire.firstName} ${hire.lastName}`;
    const created = await createHire(ctx, input);
    const departmentId = departmentIds.get(hire.department.toLowerCase());
    await assignDepartment(
      ctx,
      assignDepartmentSchema.parse({ employeeId: created.employeeId, departmentId }),
    );

    options.awaitingToken.current = null;
    const sent = await sendContract(ctx, created.contractId);
    const token = sent.emailed ? options.awaitingToken.current : tokenOf(sent.link);
    options.awaitingToken.current = null;
    if (!token) {
      throw new StopError(
        `${name}'s contract was emailed, but its link could not be read from the email. ` +
          'Their offer stays out for them to accept from the email.',
      );
    }

    // The offer page: accept with the name typed and both boxes ticked, then payroll details.
    await acceptOffer(
      acceptOfferSchema.parse({ token, fullName: name, readContract: true, readStatements: true }),
      SCRIPT_META,
    );
    await submitPayrollDetails(payrollDetailsSchema.parse(demoPayroll(token, name)), SCRIPT_META);

    log(
      `  · ${name}: ${hire.positionTitle}, ${hire.employmentType}, ` +
        `${input.payBasis === 'annual' ? `$${input.payRate}/yr` : `$${input.payRate}/h`} ` +
        `(${basis}); ${hire.login === 'manager' ? 'Manager' : 'Staff'} login; ` +
        `contract ${sent.emailed ? 'emailed' : 'NOT emailed (email not set up)'}; accepted.`,
    );
    if (created.warnings.length > 0) log(`    warnings: ${created.warnings.join(' | ')}`);
    outcomes.push({
      business: business.companyName,
      name,
      status: 'hired',
      contractEmailed: sent.emailed,
      loginRole: hire.login,
      basis,
      payRate: input.payRate,
      payBasis: input.payBasis,
      warnings: created.warnings,
    });
  }
  return { business: business.companyName, status: 'done', hires: outcomes };
}

export async function hireStaff(options: {
  admin: PlatformAdmin;
  businesses?: DemoBusiness[];
  startDate?: string;
  log?: (line: string) => void;
}): Promise<BusinessOutcome[]> {
  const log = options.log ?? (() => {});
  if (!isFairWorkConfigured()) {
    throw new StopError(
      'FWC_API_KEY is not set. Every role here is paid from the Fair Work pay database ' +
        '(award-free salaries are sized from it too), so nothing was hired rather than guess a ' +
        'rate. Set FWC_API_KEY (https://developer.fwc.gov.au) and run again.',
    );
  }
  const startDate = options.startDate ?? nextMonday();
  log(
    `Start date ${startDate}. Email ${isEmailConfigured() ? 'is' : 'is NOT'} set up` +
      (isEmailConfigured() ? '; contracts are emailed for real.' : '; links are used directly.'),
  );

  const awaitingToken = { current: null as string | null };
  const original = globalThis.fetch;
  globalThis.fetch = captureOfferLinks(original, (token) => {
    awaitingToken.current = token;
  });
  try {
    const all = await listBusinesses(options.admin);
    const outcomes: BusinessOutcome[] = [];
    for (const business of options.businesses ?? DEMO_BUSINESSES) {
      const row = all.find((candidate) => candidate.name === business.companyName);
      if (!row) {
        log(`- ${business.companyName}: not found. Run onboard-businesses.ts first.`);
        outcomes.push({ business: business.companyName, status: 'not_found' });
        continue;
      }
      outcomes.push(await hireBusiness(business, row.id, { startDate, log, awaitingToken }));
    }
    return outcomes;
  } finally {
    globalThis.fetch = original;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const as = args.get('as');
  const only = splitNames(args.get('only'));
  const admin = await findPlatformAdmin(typeof as === 'string' ? as : undefined);
  console.log(`Acting as platform owner ${admin.email}, hiring as each business's admin.`);
  try {
    const outcomes = await hireStaff({
      admin,
      businesses: only.length
        ? DEMO_BUSINESSES.filter((business) => only.includes(business.companyName))
        : undefined,
      log: (line) => console.log(line),
    });
    return outcomes.every((outcome) => outcome.status === 'done') ? 0 : 3;
  } catch (error) {
    if (error instanceof StopError || error instanceof AppError) {
      console.error(`\nStopped: ${error.message}`);
      return 4;
    }
    throw error;
  }
}

if (isEntry('hire-staff.ts')) runMain(main);
