import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { addDaysToDate } from '@/lib/dates';
import { acceptOffer } from '@/modules/hiring/public';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, payrollBinding, sendContract } from '@/modules/hiring/service';
import { linkEmployeeLogin } from '@/modules/hiring/staff-service';
import { taxCents } from '@/modules/payroll/payg';
import { listPayslipsForRoster } from '@/modules/payroll/queries';
import { authoriseRosterSchema } from '@/modules/payroll/schemas';
import { authoriseRoster } from '@/modules/payroll/service';
import { createRosterSchema, publishRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import { createRoster, publishRoster, saveShift } from '@/modules/roster/service';
import type { TenantContext } from '@/server/context';
import { encryptField } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';

import {
  addMember,
  contextFor,
  createWorkspace,
  destroyWorkspace,
  handedOver,
} from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let staff: { userId: string; employeeId: string; name: string }[] = [];

/** Hires someone on a casual hourly contract and links the employee record to their login. */
async function hire(firstName: string): Promise<{ userId: string; employeeId: string }> {
  const userId = await addMember(tenantId, mail(firstName), `${firstName} Payg`, 'member');
  const hired = await createHire(
    owner,
    createHireSchema.parse({
      firstName,
      lastName: 'Payg',
      email: mail(`${firstName}-hire`),
      employmentType: 'casual',
      positionTitle: 'Assistant',
      startDate: '2026-07-06',
      payBasis: 'hourly',
      payRate: '40',
    }),
  );
  const link = handedOver(await sendContract(owner, hired.contractId));
  await acceptOffer(
    acceptOfferSchema.parse({
      token: link.split('/offer/')[1],
      fullName: `${firstName} Payg`,
      readContract: true,
      readStatements: true,
    }),
    { ip: null, userAgent: null },
  );
  await linkEmployeeLogin(owner, { employeeId: hired.employeeId, userId });
  return { userId, employeeId: hired.employeeId };
}

/** What the new hire would have entered on their tax file number declaration. */
async function declare(
  employeeId: string,
  answers: { tfn: boolean; resident: boolean; threshold: boolean; studyLoan: boolean },
) {
  const tfn = answers.tfn
    ? encryptField('123456782', payrollBinding(tenantId, employeeId, 'tfn'))
    : null;
  await adminDb().execute(sql`
    insert into employee_payroll_details
      (tenant_id, employee_id, tax_file_number_ciphertext, tax_resident,
       claims_tax_free_threshold, has_study_loan)
    values (${tenantId}, ${employeeId}, ${tfn}, ${answers.resident}, ${answers.threshold},
            ${answers.studyLoan})`);
}

async function weekRoster(startsOn: string): Promise<string> {
  const rosterId = (await createRoster(owner, createRosterSchema.parse({ startsOn, span: 'week' })))
    .id;
  for (const person of staff) {
    // 9:00 to 17:30 with a 30 minute unpaid break: 8 hours × $40 = $320 a day, two days.
    for (const date of [startsOn, addDaysToDate(startsOn, 1)]) {
      await saveShift(
        owner,
        saveShiftSchema.parse({
          rosterId,
          userId: person.userId,
          date,
          startTime: '09:00',
          endTime: '17:30',
          breaks: [{ minutes: 30, paid: false }],
        }),
      );
    }
  }
  await publishRoster(owner, publishRosterSchema.parse({ id: rosterId }));
  return rosterId;
}

const authorise = (rosterId: string, paymentDate: string) =>
  authoriseRosterSchema.parse({
    rosterId,
    paymentDate,
    superRate: '12',
    employerDetails: 'PAYG Test Pty Ltd',
  });

beforeAll(async () => {
  const workspace = await createWorkspace('PAYG Test', mail('payg-owner'));
  tenantId = workspace.tenantId;
  owner = await contextFor(workspace.ownerId, tenantId);
  const resident = await hire('Rita');
  const noThreshold = await hire('Nico');
  const foreign = await hire('Faye');
  const undeclared = await hire('Uma');
  const noTfn = await hire('Tom');
  await declare(resident.employeeId, {
    tfn: true,
    resident: true,
    threshold: true,
    studyLoan: false,
  });
  await declare(noThreshold.employeeId, {
    tfn: true,
    resident: true,
    threshold: false,
    studyLoan: true,
  });
  await declare(foreign.employeeId, {
    tfn: true,
    resident: false,
    threshold: false,
    studyLoan: false,
  });
  await declare(noTfn.employeeId, {
    tfn: false,
    resident: true,
    threshold: true,
    studyLoan: false,
  });
  staff = [
    { ...resident, name: 'Rita Payg' },
    { ...noThreshold, name: 'Nico Payg' },
    { ...foreign, name: 'Faye Payg' },
    { ...undeclared, name: 'Uma Payg' },
    { ...noTfn, name: 'Tom Payg' },
  ];
  userIds = [workspace.ownerId, ...staff.map((person) => person.userId)];
}, 180_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
}, 60_000);

describe('PAYG withholding on a pay run', () => {
  it('works out tax from each declaration, and names who needs it entered by hand', async () => {
    const rosterId = await weekRoster('2026-10-05');
    const result = await authoriseRoster(owner, authorise(rosterId, '2026-10-08'));
    expect(result.created).toBe(5);
    expect(result.taxByHand.map((person) => person.name).sort()).toEqual(['Tom Payg', 'Uma Payg']);

    const slips = new Map(
      (await listPayslipsForRoster(owner, rosterId)).map((slip) => [slip.employeeName, slip]),
    );
    const gross = 64000;
    expect(slips.get('Rita Payg')).toMatchObject({
      gross: '640.00',
      taxWithheld: (taxCents(gross, 'weekly', 2) / 100).toFixed(2),
    });
    // No threshold, and $640 a week is under the study loan repayment threshold.
    expect(slips.get('Nico Payg')?.taxWithheld).toBe(
      (taxCents(gross, 'weekly', 1) / 100).toFixed(2),
    );
    expect(slips.get('Faye Payg')?.taxWithheld).toBe(
      (taxCents(gross, 'weekly', 3) / 100).toFixed(2),
    );
    for (const name of ['Uma Payg', 'Tom Payg']) {
      expect(slips.get(name)).toMatchObject({ taxWithheld: '0.00', net: '640.00' });
    }
    const rita = slips.get('Rita Payg');
    expect(Number(rita?.net) + Number(rita?.taxWithheld)).toBe(640);
  });

  it('leaves tax to a person when whoever runs payroll cannot see tax details', async () => {
    const grants = new Map(owner.grants);
    grants.delete('employees.view_sensitive');
    const rosterId = await weekRoster('2026-10-12');
    const result = await authoriseRoster({ ...owner, grants }, authorise(rosterId, '2026-10-15'));
    expect(result.taxByHand).toHaveLength(5);
    const slips = await listPayslipsForRoster(owner, rosterId);
    expect(slips.every((slip) => slip.taxWithheld === '0.00')).toBe(true);
  });

  it('does not use the 2026–27 tables for a payment outside that year', async () => {
    const rosterId = await weekRoster('2027-06-28');
    const result = await authoriseRoster(owner, authorise(rosterId, '2027-07-01'));
    expect(result.taxByHand).toHaveLength(5);
  });
});
