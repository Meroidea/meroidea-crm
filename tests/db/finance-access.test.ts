import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { AppError } from '@/lib/errors';
import { acceptOffer } from '@/modules/hiring/public';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, sendContract } from '@/modules/hiring/service';
import { linkEmployeeLogin } from '@/modules/hiring/staff-service';
import { getInvoice, getInvoiceTotals, listInvoices } from '@/modules/invoices/queries';
import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import {
  markInvoicePaid,
  markInvoiceSent,
  renderInvoiceEmail,
  saveInvoice,
  sendInvoice,
  voidInvoice,
} from '@/modules/invoices/service';
import { getPayslip, listMyPayslips, listPayslipsForRoster } from '@/modules/payroll/queries';
import { authoriseRosterSchema } from '@/modules/payroll/schemas';
import { authoriseRoster, releasePayslips, setTaxWithheld } from '@/modules/payroll/service';
import { createRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import { createRoster, publishRoster, saveShift, unpublishRoster } from '@/modules/roster/service';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

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

beforeAll(async () => {
  const alpha = await createWorkspace('Finance Alpha', mail('fin-alpha'));
  const managerId = await addMember(alpha.tenantId, mail('fin-mgr'), 'Mia Manager', 'manager');
  const memberId = await addMember(alpha.tenantId, mail('fin-mem'), 'Max Member', 'member');
  const beta = await createWorkspace('Finance Beta', mail('fin-beta'));
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

describe('invoices', () => {
  const invoice = (overrides: Record<string, unknown> = {}) =>
    saveInvoiceSchema.parse({
      customerName: 'Lumen Studio',
      customerEmail: 'accounts@example.com',
      fromDetails: 'Finance Alpha Pty Ltd\nABN 51 824 753 556',
      issueDate: '2031-03-03',
      dueDate: '2031-03-17',
      taxRate: '10',
      lines: [
        { description: 'Consulting', quantity: '1.5', unitPrice: '199.99' },
        { description: 'Setup fee', quantity: '1', unitPrice: '50' },
      ],
      ...overrides,
    });
  let id: string;

  it('numbers from one and works out line totals, tax and total exactly', async () => {
    const saved = await saveInvoice(owner, invoice());
    id = saved.id;
    expect(saved.number).toBe(1);
    // 1.5 × 199.99 = 299.985 → 299.99; + 50 = 349.99; 10% = 35.00 (34.999 rounded); total 384.99.
    expect(await getInvoice(owner, id)).toMatchObject({
      status: 'draft',
      subtotal: '349.99',
      taxTotal: '35.00',
      total: '384.99',
      currency: 'AUD',
    });
  });

  it('is the owner’s alone: a manager is refused and sees no rows in the database', async () => {
    await expectCode(() => saveInvoice(manager, invoice()), 'FORBIDDEN');
    await expectCode(() => listInvoices(manager), 'FORBIDDEN');
    const rows = (await withRls(manager, (tx) =>
      tx.execute(sql`select (select count(*)::int from invoices) as invoices,
                            (select count(*)::int from invoice_lines) as lines`),
    )) as unknown as Record<string, number>[];
    expect(rows[0]).toEqual({ invoices: 0, lines: 0 });
  });

  it('never shows or changes another workspace’s invoice', async () => {
    expect(await getInvoice(outsider, id)).toBeNull();
    expect(await listInvoices(outsider)).toEqual([]);
    await expectCode(() => markInvoiceSent(outsider, id), 'NOT_FOUND');
    await expectCode(() => saveInvoice(outsider, invoice({ id })), 'NOT_FOUND');
  });

  it('replaces a draft’s lines when edited and recalculates', async () => {
    await saveInvoice(
      owner,
      invoice({
        id,
        taxRate: '0',
        lines: [{ description: 'Flat fee', quantity: '2', unitPrice: '100' }],
      }),
    );
    const edited = await getInvoice(owner, id);
    expect(edited?.lines.map((line) => line.description)).toEqual(['Flat fee']);
    expect(edited).toMatchObject({
      subtotal: '200.00',
      taxTotal: '0.00',
      total: '200.00',
      number: 1,
    });
  });

  it('does not mark an invoice sent when the email could not go out', async () => {
    const result = await sendInvoice(owner, id);
    expect(result.sent).toBe(false);
    expect((await getInvoice(owner, id))?.status).toBe('draft');
  });

  it('follows draft → sent → paid, locks editing once sent, and refuses steps out of order', async () => {
    await expectCode(() => markInvoicePaid(owner, id), 'CONFLICT');
    await markInvoiceSent(owner, id);
    await expectCode(() => saveInvoice(owner, invoice({ id })), 'CONFLICT');
    expect(await getInvoiceTotals(owner)).toMatchObject({ outstanding: '200.00', paid: '0' });
    await markInvoicePaid(owner, id);
    expect((await getInvoice(owner, id))?.paidAt).toBeInstanceOf(Date);
    await expectCode(() => voidInvoice(owner, id), 'CONFLICT');
    expect(await getInvoiceTotals(owner)).toMatchObject({ outstanding: '0', paid: '200.00' });
  });

  it('gives the next invoice the next number, and flags a sent one past its due date', async () => {
    const second = await saveInvoice(
      owner,
      invoice({ issueDate: '2020-01-01', dueDate: '2020-01-15' }),
    );
    expect(second.number).toBe(2);
    await markInvoiceSent(owner, second.id);
    expect((await listInvoices(owner))[0]).toMatchObject({ number: 2, overdue: true });
  });

  it('writes an email that calls a taxed invoice a tax invoice and shows the seller details', async () => {
    const detail = await getInvoice(owner, (await listInvoices(owner))[0]?.id ?? '');
    if (!detail) throw new Error('no invoice');
    const email = renderInvoiceEmail(detail, 'Finance Alpha');
    expect(email.subject).toBe('Tax invoice INV-0002 from Finance Alpha');
    expect(email.text).toContain('1.5 x Consulting @ $199.99 = $299.99');
    expect(email.text).toContain('Tax (10%): $35');
    expect(email.text).toContain('ABN 51 824 753 556');
  });

  it('rejects a due date before the invoice date and an empty invoice', () => {
    expect(saveInvoiceSchema.safeParse({ ...invoice(), dueDate: '2031-03-01' }).success).toBe(
      false,
    );
    expect(saveInvoiceSchema.safeParse({ ...invoice(), lines: [] }).success).toBe(false);
  });
});

describe('payslips from an authorised roster', () => {
  let rosterId: string;
  let memberEmployee: string;
  let payslipId: string;
  const authorise = (overrides: Record<string, unknown> = {}) =>
    authoriseRosterSchema.parse({
      rosterId,
      paymentDate: '2031-06-12',
      superRate: '12',
      employerDetails: 'Finance Alpha Pty Ltd\nABN 51 824 753 556',
      ...overrides,
    });

  beforeAll(async () => {
    // Hire the member on an hourly contract and tie the employee record to their login.
    const hired = await createHire(
      owner,
      createHireSchema.parse({
        firstName: 'Max',
        lastName: 'Member',
        email: mail('max-hire'),
        employmentType: 'casual',
        positionTitle: 'Assistant',
        startDate: '2031-01-06',
        payBasis: 'hourly',
        payRate: '33.33',
      }),
    );
    memberEmployee = hired.employeeId;
    const { link } = await sendContract(owner, hired.contractId);
    await acceptOffer(
      acceptOfferSchema.parse({
        token: link.split('/offer/')[1],
        fullName: 'Max Member',
        readContract: true,
        readStatements: true,
      }),
      { ip: null, userAgent: null },
    );
    await linkEmployeeLogin(owner, { employeeId: memberEmployee, userId: member.userId });

    rosterId = (
      await createRoster(owner, createRosterSchema.parse({ startsOn: '2031-06-02', span: 'week' }))
    ).id;
    const shift = (
      userId: string,
      date: string,
      startTime: string,
      endTime: string,
      breakMinutes: number,
    ) =>
      saveShift(
        owner,
        saveShiftSchema.parse({ rosterId, userId, date, startTime, endTime, breakMinutes }),
      );
    await shift(member.userId, '2031-06-02', '09:00', '17:00', 30);
    await shift(member.userId, '2031-06-03', '09:00', '12:20', 0);
    // The manager is rostered too, but has no employee record to pay from.
    await shift(manager.userId, '2031-06-02', '09:00', '17:00', 30);
  }, 60_000);

  it('links one login to one employee only', async () => {
    const other = await createHire(
      owner,
      createHireSchema.parse({
        firstName: 'Other',
        lastName: 'Person',
        email: mail('other-hire'),
        employmentType: 'full_time',
        positionTitle: 'Lead',
        startDate: '2031-01-06',
        payBasis: 'hourly',
        payRate: '40',
      }),
    );
    await expectCode(
      () => linkEmployeeLogin(owner, { employeeId: other.employeeId, userId: member.userId }),
      'CONFLICT',
    );
    await expectCode(
      () => linkEmployeeLogin(owner, { employeeId: other.employeeId, userId: outsider.userId }),
      'NOT_FOUND',
    );
    await expectCode(
      () => linkEmployeeLogin(member, { employeeId: other.employeeId, userId: null }),
      'FORBIDDEN',
    );
  });

  it('will not authorise a draft roster, and only the owner may authorise', async () => {
    await expectCode(() => authoriseRoster(owner, authorise()), 'CONFLICT');
    await publishRoster(owner, rosterId);
    await expectCode(() => authoriseRoster(manager, authorise()), 'FORBIDDEN');
    await expectCode(() => authoriseRoster(outsider, authorise()), 'NOT_FOUND');
  });

  it('drafts a payslip from the worked hours at the contract rate, and reports who it skipped', async () => {
    const result = await authoriseRoster(owner, authorise());
    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([
      { name: 'Mia Manager', reason: expect.stringMatching(/not linked to an employee record/i) },
    ]);

    const [slip] = await listPayslipsForRoster(owner, rosterId);
    payslipId = slip?.id ?? '';
    // 7h30m + 3h20m = 650 minutes; 650/60 × 33.33 = 361.075 → 361.08; super 12% = 43.33.
    expect(slip).toMatchObject({
      status: 'draft',
      employeeName: 'Max Member',
      minutes: 650,
      hourlyRate: '33.33',
      gross: '361.08',
      taxWithheld: '0.00',
      net: '361.08',
      superAmount: '43.33',
    });
    expect((await getPayslip(owner, payslipId))?.shifts).toEqual([
      { date: '2031-06-02', start: '09:00', end: '17:00', minutes: 450 },
      { date: '2031-06-03', start: '09:00', end: '12:20', minutes: 200 },
    ]);
  });

  it('locks the roster once authorised', async () => {
    await expectCode(() => authoriseRoster(owner, authorise()), 'CONFLICT');
    await expectCode(() => unpublishRoster(owner, rosterId), 'CONFLICT');
    await expectCode(
      () =>
        saveShift(
          owner,
          saveShiftSchema.parse({
            rosterId,
            userId: member.userId,
            date: '2031-06-05',
            startTime: '09:00',
            endTime: '10:00',
            breakMinutes: 0,
          }),
        ),
      'CONFLICT',
    );
  });

  it('keeps a draft payslip from the person it is for, in the service and the database', async () => {
    expect(await listMyPayslips(member)).toEqual([]);
    expect(await getPayslip(member, payslipId)).toBeNull();
    const rows = (await withRls(member, (tx) =>
      tx.execute(sql`select count(*)::int as n from payslips`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it('takes the tax withheld from whoever runs payroll, and works net pay out from it', async () => {
    await expectCode(
      () => setTaxWithheld(owner, { id: payslipId, taxWithheld: '9999.00' }),
      'VALIDATION',
    );
    await expectCode(
      () => setTaxWithheld(member, { id: payslipId, taxWithheld: '10.00' }),
      'FORBIDDEN',
    );
    await setTaxWithheld(owner, { id: payslipId, taxWithheld: '52.00' });
    expect(await getPayslip(owner, payslipId)).toMatchObject({
      taxWithheld: '52.00',
      net: '309.08',
    });
  });

  it('shows a released payslip to its owner only, and then stops it changing', async () => {
    await expectCode(() => releasePayslips(member, rosterId), 'FORBIDDEN');
    expect(await releasePayslips(owner, rosterId)).toEqual({ released: 1 });

    expect((await listMyPayslips(member)).map((slip) => slip.id)).toEqual([payslipId]);
    expect(await getPayslip(member, payslipId)).toMatchObject({
      net: '309.08',
      superRate: '12.00',
    });

    // A colleague and another workspace still see nothing.
    expect(await listMyPayslips(manager)).toEqual([]);
    expect(await getPayslip(manager, payslipId)).toBeNull();
    expect(await getPayslip(outsider, payslipId)).toBeNull();
    const rows = (await withRls(manager, (tx) =>
      tx.execute(sql`select count(*)::int as n from payslips`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);

    await expectCode(
      () => setTaxWithheld(owner, { id: payslipId, taxWithheld: '1.00' }),
      'VALIDATION',
    );
    await expectCode(() => releasePayslips(owner, rosterId), 'CONFLICT');
  });

  it('cannot be altered by its owner through the database', async () => {
    await withRls(member, (tx) =>
      tx.execute(sql`update payslips set gross = 99999, net = 99999 where id = ${payslipId}`),
    );
    expect((await getPayslip(owner, payslipId))?.gross).toBe('361.08');
  });
});
