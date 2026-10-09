import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A throwaway key so the suite does not depend on a developer's .env.local.
process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { AppError } from '@/lib/errors';
import {
  acceptOffer,
  declineOffer,
  getOfferByToken,
  submitPayrollDetails,
} from '@/modules/hiring/public';
import { getEmployee, listEmployees } from '@/modules/hiring/queries';
import {
  acceptOfferSchema,
  createHireSchema,
  payrollDetailsSchema,
} from '@/modules/hiring/schemas';
import {
  createHire,
  revealPayrollDetails,
  sendContract,
  withdrawContract,
} from '@/modules/hiring/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let member: TenantContext;
let outsider: TenantContext;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const hire = (overrides: Record<string, unknown> = {}) =>
  createHireSchema.parse({
    firstName: 'Sam',
    lastName: 'Starter',
    email: mail('sam'),
    employmentType: 'casual',
    positionTitle: 'Assistant',
    startDate: '2031-03-03',
    payBasis: 'hourly',
    payRate: '35.50',
    awardCode: 'MA000002',
    awardName: 'Example Award 2020',
    classification: 'Level 2',
    minimumRate: '31.20',
    ...overrides,
  });

const tokenOf = (link: string) => link.split('/offer/')[1] ?? '';

const payroll = (token: string, overrides: Record<string, unknown> = {}) =>
  payrollDetailsSchema.parse({
    token,
    taxFileNumber: '123 456 782',
    taxResident: 'yes',
    claimsTaxFreeThreshold: 'yes',
    hasStudyLoan: 'no',
    bankAccountName: 'Sam Starter',
    bankBsb: '062-000',
    bankAccount: '12345678',
    superFundName: 'Example Super',
    superMemberNumber: 'M-998877',
    ...overrides,
  });

beforeAll(async () => {
  const alpha = await createWorkspace('Hiring Alpha', mail('hire-alpha'));
  const managerId = await addMember(alpha.tenantId, mail('hire-mgr'), 'Mia Manager', 'manager');
  const memberId = await addMember(alpha.tenantId, mail('hire-mem'), 'Max Member', 'member');
  const beta = await createWorkspace('Hiring Beta', mail('hire-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, managerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who can hire', () => {
  it('lets the owner record a hire with a draft contract and the right statements', async () => {
    const created = await createHire(owner, hire());
    const detail = await getEmployee(owner, created.employeeId);
    expect(detail).toMatchObject({ firstName: 'Sam', status: 'pending' });
    expect(detail?.contract).toMatchObject({
      status: 'draft',
      employmentType: 'casual',
      payRate: '35.50',
      currency: 'AUD',
      minimumRate: '31.20',
      rateSource: 'manual',
    });
    expect(detail?.contract?.statements.map((s) => s.key)).toEqual(['fwis', 'ceis']);
    expect(created.warnings.join(' ')).toMatch(/casual loading/);
  });

  it('refuses a manager and a member: hiring is the owner’s alone by default', async () => {
    await expectCode(() => createHire(manager, hire()), 'FORBIDDEN');
    await expectCode(() => createHire(member, hire()), 'FORBIDDEN');
    await expectCode(() => listEmployees(member), 'FORBIDDEN');
  });

  it('hides employment records from a member at the database, past the service', async () => {
    const rows = (await withRls(member, (tx) =>
      tx.execute(sql`select
        (select count(*)::int from employees) as employees,
        (select count(*)::int from employment_contracts) as contracts,
        (select count(*)::int from employee_payroll_details) as payroll`),
    )) as unknown as Record<string, number>[];
    expect(rows[0]).toEqual({ employees: 0, contracts: 0, payroll: 0 });
  });

  it('never shows another workspace’s hires', async () => {
    const created = await createHire(owner, hire({ email: mail('cross') }));
    expect(await getEmployee(outsider, created.employeeId)).toBeNull();
    expect((await listEmployees(outsider)).map((row) => row.id)).not.toContain(created.employeeId);
    await expectCode(() => sendContract(outsider, created.contractId), 'NOT_FOUND');
  });

  it('refuses terms that break a rule, naming the field', async () => {
    await expectCode(() => createHire(owner, hire({ payRate: '25.00' })), 'VALIDATION');
    await expectCode(
      () => createHire(owner, hire({ employmentType: 'fixed_term', hoursPerWeek: '38' })),
      'VALIDATION',
    );
    // A lawful reason for a lower rate lets it through, and is kept on the contract.
    const junior = await createHire(
      owner,
      hire({
        email: mail('junior'),
        payRate: '25.00',
        belowMinimumReason: 'Junior rate, 17 years',
      }),
    );
    expect((await getEmployee(owner, junior.employeeId))?.contract?.belowMinimumReason).toBe(
      'Junior rate, 17 years',
    );
  });
});

describe('sending and accepting a contract', () => {
  let employeeId: string;
  let contractId: string;
  let token: string;

  beforeAll(async () => {
    const created = await createHire(
      owner,
      hire({ email: mail('accept'), firstName: 'Ava', lastName: 'Accept' }),
    );
    employeeId = created.employeeId;
    contractId = created.contractId;
  });

  it('freezes the wording and issues a link when sent; no email provider means it is not emailed', async () => {
    const sent = await sendContract(owner, contractId);
    token = tokenOf(sent.link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sent.emailed).toBe(false);

    const offer = await getOfferByToken(token);
    expect(offer).toMatchObject({ status: 'sent', firstName: 'Ava', employerName: 'Hiring Alpha' });
    expect(offer?.body).toContain('Ava Accept');
    expect(offer?.statements).toHaveLength(2);
  });

  it('stores only a hash of the link’s secret', async () => {
    const rows = (await adminDb().execute(
      sql`select token_hash from employment_contracts where id = ${contractId}`,
    )) as unknown as { token_hash: string }[];
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.token_hash).not.toContain(token);
  });

  it('gives nothing for a wrong or expired link', async () => {
    expect(await getOfferByToken('x'.repeat(43))).toBeNull();
    await adminDb().execute(
      sql`update employment_contracts set token_expires_at = now() - interval '1 minute' where id = ${contractId}`,
    );
    expect(await getOfferByToken(token)).toBeNull();
    await expectCode(
      () =>
        acceptOffer(
          acceptOfferSchema.parse({
            token,
            fullName: 'Ava Accept',
            readContract: true,
            readStatements: true,
          }),
          META,
        ),
      'NOT_FOUND',
    );
    await adminDb().execute(
      sql`update employment_contracts set token_expires_at = now() + interval '7 days' where id = ${contractId}`,
    );
  });

  it('refuses tax and bank details before the contract is accepted', async () => {
    await expectCode(() => submitPayrollDetails(payroll(token), META), 'NOT_FOUND');
  });

  it('needs the typed name to match, then records who accepted, when and from where', async () => {
    const accept = (fullName: string) =>
      acceptOffer(
        acceptOfferSchema.parse({ token, fullName, readContract: true, readStatements: true }),
        META,
      );
    await expectCode(() => accept('Someone Else'), 'VALIDATION');
    await accept('ava  accept');

    const detail = await getEmployee(owner, employeeId);
    expect(detail?.status).toBe('active');
    expect(detail?.contract).toMatchObject({ status: 'accepted', acceptedName: 'ava  accept' });
    expect(detail?.contract?.acceptedAt).toBeInstanceOf(Date);

    const audit = (await withRls(owner, (tx) =>
      tx.execute(sql`select action, actor_type, host(ip) as ip from audit_logs
                     where tenant_id = ${alphaTenant} and entity_id = ${contractId}
                     order by created_at`),
    )) as unknown as { action: string; actor_type: string; ip: string | null }[];
    expect(audit.at(-1)).toEqual({
      action: 'accept',
      actor_type: 'employee_link',
      ip: '203.0.113.7',
    });
  });

  it('cannot be accepted twice, declined after accepting, or re-sent', async () => {
    await expectCode(
      () =>
        acceptOffer(
          acceptOfferSchema.parse({
            token,
            fullName: 'Ava Accept',
            readContract: true,
            readStatements: true,
          }),
          META,
        ),
      'NOT_FOUND',
    );
    await expectCode(() => declineOffer(token, META), 'NOT_FOUND');
    await expectCode(() => sendContract(owner, contractId), 'CONFLICT');
  });

  it('takes tax, bank and super details once, and keeps the numbers out of the database in the clear', async () => {
    expect((await getOfferByToken(token))?.payrollWanted).toBe(true);
    await submitPayrollDetails(payroll(token), META);
    expect((await getOfferByToken(token))?.payrollWanted).toBe(false);
    await expectCode(() => submitPayrollDetails(payroll(token), META), 'CONFLICT');

    const stored = (await adminDb().execute(
      sql`select row_to_json(p)::text as row from employee_payroll_details p where employee_id = ${employeeId}`,
    )) as unknown as { row: string }[];
    for (const secret of ['123456782', '062000', '12345678', 'M-998877']) {
      expect(stored[0]?.row).not.toContain(secret);
    }
    expect(stored[0]?.row).toContain('"bank_account_last3":"678"');
  });

  it('shows the owner a summary, and the numbers only on an audited reveal', async () => {
    const detail = await getEmployee(owner, employeeId);
    expect(detail?.payroll).toMatchObject({
      hasTaxFileNumber: true,
      bankAccountLast3: '678',
      superFundName: 'Example Super',
    });

    expect(await revealPayrollDetails(owner, employeeId)).toEqual({
      taxFileNumber: '123456782',
      bankBsb: '062000',
      bankAccount: '12345678',
      superMemberNumber: 'M-998877',
    });
    const audit = (await withRls(owner, (tx) =>
      tx.execute(sql`select count(*)::int as n from audit_logs
                     where tenant_id = ${alphaTenant} and action = 'view_sensitive'
                       and entity_id = ${employeeId}`),
    )) as unknown as { n: number }[];
    expect(audit[0]?.n).toBe(1);
  });

  it('refuses the reveal to a manager, a member and another workspace', async () => {
    await expectCode(() => revealPayrollDetails(manager, employeeId), 'FORBIDDEN');
    await expectCode(() => revealPayrollDetails(member, employeeId), 'FORBIDDEN');
    await expectCode(() => revealPayrollDetails(outsider, employeeId), 'NOT_FOUND');
  });

  it('fails to decrypt a number copied onto another person’s row', async () => {
    const other = await createHire(
      owner,
      hire({ email: mail('other'), firstName: 'Otto', lastName: 'Other' }),
    );
    await adminDb().execute(sql`
      insert into employee_payroll_details (tenant_id, employee_id, tax_file_number_ciphertext)
      select tenant_id, ${other.employeeId}, tax_file_number_ciphertext
      from employee_payroll_details where employee_id = ${employeeId}`);
    await expectCode(() => revealPayrollDetails(owner, other.employeeId), 'INTERNAL');
  });
});

describe('declining and withdrawing', () => {
  it('records a decline and leaves the person pending', async () => {
    const created = await createHire(owner, hire({ email: mail('decline') }));
    const token = tokenOf((await sendContract(owner, created.contractId)).link);
    await declineOffer(token, META);
    const detail = await getEmployee(owner, created.employeeId);
    expect(detail?.status).toBe('pending');
    expect(detail?.contract?.status).toBe('declined');
  });

  it('kills the link when the owner withdraws, and a re-send replaces the old link', async () => {
    const created = await createHire(owner, hire({ email: mail('withdraw') }));
    const first = tokenOf((await sendContract(owner, created.contractId)).link);
    const second = tokenOf((await sendContract(owner, created.contractId)).link);
    expect(await getOfferByToken(first)).toBeNull();
    expect(await getOfferByToken(second)).not.toBeNull();

    await withdrawContract(owner, created.contractId);
    expect(await getOfferByToken(second)).toBeNull();
    await expectCode(() => withdrawContract(member, created.contractId), 'FORBIDDEN');
  });
});
