import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import {
  auditLogs,
  employeePayrollDetails,
  employees,
  employmentContracts,
  tenants,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { encryptField, hashLinkToken, isEncryptionConfigured } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';

import type { Statement } from './compliance';
import type { AcceptOfferInput, PayrollDetailsInput } from './schemas';
import { payrollBinding } from './service';
import type { PublicOffer } from './types';

/**
 * The new hire's side of hiring. They have no account, so there is no session for RLS to match:
 * this file uses the privileged connection instead, and the one-time link is the only
 * credential. Every function therefore starts from the link's hash and touches nothing but the
 * single contract it names (ADR-026). Nothing here takes a tenant or record id from the caller.
 */

/** After accepting, how long the same link stays good for entering tax, bank and super details. */
const PAYROLL_WINDOW_DAYS = 14;
const GONE = 'This link is no longer valid. Ask the person who sent it for a new one.';

type Db = ReturnType<typeof adminDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function findByToken(db: Db | Tx, token: string, lock = false) {
  const query = db
    .select({
      contract: employmentContracts,
      employee: employees,
      tenantName: tenants.name,
      timezone: tenants.timezone,
    })
    .from(employmentContracts)
    .innerJoin(
      employees,
      and(
        eq(employees.tenantId, employmentContracts.tenantId),
        eq(employees.id, employmentContracts.employeeId),
      ),
    )
    .innerJoin(tenants, eq(tenants.id, employmentContracts.tenantId))
    .where(
      and(
        eq(employmentContracts.tokenHash, hashLinkToken(token)),
        isNull(employmentContracts.deletedAt),
        isNull(employees.deletedAt),
      ),
    )
    .limit(1);
  const [row] = await (lock ? query.for('update', { of: employmentContracts }) : query);
  if (!row || !row.contract.tokenExpiresAt || row.contract.tokenExpiresAt < new Date()) return null;
  return row;
}

async function hasPayroll(db: Db | Tx, tenantId: string, employeeId: string) {
  const [row] = await db
    .select({ id: employeePayrollDetails.id })
    .from(employeePayrollDetails)
    .where(
      and(
        eq(employeePayrollDetails.tenantId, tenantId),
        eq(employeePayrollDetails.employeeId, employeeId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function record(
  tx: Tx,
  entry: { tenantId: string; action: string; entityType: string; entityId: string },
  meta: { ip: string | null; userAgent: string | null },
) {
  return tx.insert(auditLogs).values({
    ...entry,
    actorUserId: null,
    actorType: 'employee_link',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function getOfferByToken(token: string): Promise<PublicOffer | null> {
  const db = adminDb();
  const row = await findByToken(db, token);
  if (!row) return null;
  const { contract, employee } = row;
  if (
    contract.status !== 'sent' &&
    contract.status !== 'accepted' &&
    contract.status !== 'declined'
  ) {
    return null;
  }

  if (!contract.viewedAt) {
    await db
      .update(employmentContracts)
      .set({ viewedAt: new Date() })
      .where(eq(employmentContracts.id, contract.id));
  }

  const employeeOfRecord = contract.employmentType !== 'contractor';
  const received = await hasPayroll(db, contract.tenantId, employee.id);
  return {
    status: contract.status,
    employerName: row.tenantName,
    timezone: row.timezone,
    firstName: employee.firstName,
    employmentType: contract.employmentType,
    positionTitle: contract.positionTitle,
    body: contract.body ?? '',
    statements: contract.statements as Statement[],
    acceptedAt: contract.acceptedAt,
    payrollWanted: contract.status === 'accepted' && employeeOfRecord && !received,
    payrollReceived: received,
    payrollAvailable: isEncryptionConfigured(),
  };
}

const sameName = (typed: string, first: string, last: string) =>
  typed.trim().replace(/\s+/g, ' ').toLowerCase() ===
  `${first} ${last}`.replace(/\s+/g, ' ').toLowerCase();

export async function acceptOffer(
  input: AcceptOfferInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await adminDb().transaction(async (tx) => {
    const row = await findByToken(tx, input.token, true);
    if (!row || row.contract.status !== 'sent') throw new AppError('NOT_FOUND', GONE);
    const { contract, employee } = row;
    if (!sameName(input.fullName, employee.firstName, employee.lastName)) {
      throw new AppError('VALIDATION', 'The name does not match the offer.', {
        fullName: [
          `Type your name exactly as it appears on the offer: ${employee.firstName} ${employee.lastName}`,
        ],
      });
    }

    const now = new Date();
    await tx
      .update(employmentContracts)
      .set({
        status: 'accepted',
        acceptedAt: now,
        acceptedName: input.fullName.trim(),
        acceptedIp: meta.ip,
        acceptedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
        // The same link now only opens the follow-up form, for a limited time.
        tokenExpiresAt: new Date(now.getTime() + PAYROLL_WINDOW_DAYS * 86_400_000),
      })
      .where(eq(employmentContracts.id, contract.id));
    await tx.update(employees).set({ status: 'active' }).where(eq(employees.id, employee.id));
    await record(
      tx,
      {
        tenantId: contract.tenantId,
        action: 'accept',
        entityType: 'employment_contract',
        entityId: contract.id,
      },
      meta,
    );
  });
}

export async function declineOffer(
  token: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await adminDb().transaction(async (tx) => {
    const row = await findByToken(tx, token, true);
    if (!row || row.contract.status !== 'sent') throw new AppError('NOT_FOUND', GONE);
    await tx
      .update(employmentContracts)
      .set({ status: 'declined', declinedAt: new Date() })
      .where(eq(employmentContracts.id, row.contract.id));
    await record(
      tx,
      {
        tenantId: row.contract.tenantId,
        action: 'decline',
        entityType: 'employment_contract',
        entityId: row.contract.id,
      },
      meta,
    );
  });
}

/** Taken once, after acceptance. Identifying numbers are encrypted before they reach the database. */
export async function submitPayrollDetails(
  input: PayrollDetailsInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await adminDb().transaction(async (tx) => {
    const row = await findByToken(tx, input.token, true);
    if (
      !row ||
      row.contract.status !== 'accepted' ||
      row.contract.employmentType === 'contractor'
    ) {
      throw new AppError('NOT_FOUND', GONE);
    }
    const { tenantId } = row.contract;
    const employeeId = row.employee.id;
    if (await hasPayroll(tx, tenantId, employeeId)) {
      throw new AppError(
        'CONFLICT',
        'Your details have already been received. Contact your employer to change them.',
      );
    }

    const seal = (value: string | null, field: string) =>
      value ? encryptField(value, payrollBinding(tenantId, employeeId, field)) : null;
    await tx.insert(employeePayrollDetails).values({
      tenantId,
      employeeId,
      taxFileNumberCiphertext: seal(input.taxFileNumber, 'tfn'),
      taxResident: input.taxResident,
      claimsTaxFreeThreshold: input.claimsTaxFreeThreshold,
      hasStudyLoan: input.hasStudyLoan,
      bankAccountName: input.bankAccountName,
      bankBsbCiphertext: seal(input.bankBsb, 'bsb'),
      bankAccountCiphertext: seal(input.bankAccount, 'account'),
      bankAccountLast3: input.bankAccount.slice(-3),
      superFundName: input.superFundName,
      superFundUsi: input.superFundUsi,
      superMemberCiphertext: seal(input.superMemberNumber, 'super'),
    });
    await record(
      tx,
      { tenantId, action: 'create', entityType: 'employee_payroll_details', entityId: employeeId },
      meta,
    );
  });
}
