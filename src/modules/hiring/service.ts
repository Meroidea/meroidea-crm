import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { employeePayrollDetails, employees, employmentContracts, roles } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { createLinkToken, decryptField } from '@/server/crypto';
import { withRls } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';
import { getAwardRates, isFairWorkConfigured } from '@/server/fair-work';

import type { AwardRateSchedule } from './award-rates';
import { checkOffer, statementsFor } from './compliance';
import { contractWording } from './contract-view';
import { normalizeDigits } from './identifiers';
import type { CreateHireInput } from './schemas';
import type { RevealedPayroll } from './types';
import { renderEmail } from '@/server/email-template';

/** How long a new hire has to open their link and respond. */
const LINK_DAYS = 14;

/** What binds a ciphertext to its row; must match what the public path encrypted with. */
export const payrollBinding = (tenantId: string, employeeId: string, field: string) =>
  `${tenantId}:${employeeId}:${field}`;

/**
 * Records a new hire and a draft contract. Nothing is sent yet: the admin reviews the wording
 * and any warnings first. The minimum rate is read from the pay database here, on the server,
 * whenever it is connected, so a figure typed or altered in the browser is never trusted over it.
 */
export async function createHire(
  ctx: TenantContext,
  input: CreateHireInput,
): Promise<{
  employeeId: string;
  /** The Employee ID the database gave the new hire. */
  employeeNumber: number;
  contractId: string;
  warnings: string[];
}> {
  requirePermission(ctx, 'employees.manage');
  // Choosing a login for them is giving someone access, which is users.manage's to decide.
  if (input.loginRoleId) requirePermission(ctx, 'users.manage');
  const contractor = input.employmentType === 'contractor';

  let minimumRate = contractor ? null : input.minimumRate;
  let rateSource: 'fair_work' | 'manual' | 'none' = minimumRate ? 'manual' : 'none';
  let rateSchedule: AwardRateSchedule | null = null;
  if (
    input.employmentType !== 'contractor' &&
    input.awardCode &&
    input.classificationRef &&
    isFairWorkConfigured()
  ) {
    // The minimum depends on the kind of employment: a casual's includes the casual loading.
    rateSchedule = await getAwardRates(
      input.awardCode,
      input.classificationRef,
      input.employmentType,
    );
    if (rateSchedule?.minimumHourly) {
      minimumRate = rateSchedule.minimumHourly;
      rateSource = 'fair_work';
    }
  }

  const terms = {
    employmentType: input.employmentType,
    startDate: input.startDate,
    endDate: input.endDate,
    // Casual hours vary and a contractor has none; a value left in a hidden field is dropped.
    hoursPerWeek: input.employmentType === 'casual' || contractor ? null : input.hoursPerWeek,
    payBasis: input.payBasis,
    payRate: input.payRate,
    awardCode: contractor ? null : input.awardCode,
    classification: contractor ? null : input.classification,
    minimumRate,
    belowMinimumReason: input.belowMinimumReason,
    contractorAbn: contractor && input.contractorAbn ? normalizeDigits(input.contractorAbn) : null,
  };
  const { errors, warnings } = checkOffer(ctx.tenant.country, {
    ...terms,
    minimumIncludesCasualLoading: input.employmentType === 'casual' && rateSource === 'fair_work',
  });
  if (Object.keys(errors).length > 0) {
    throw new AppError(
      'VALIDATION',
      'Some of these terms need fixing before you can continue.',
      errors,
    );
  }

  return withRls(ctx, async (tx) => {
    if (input.loginRoleId) {
      const [role] = await tx
        .select({ key: roles.key })
        .from(roles)
        .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.id, input.loginRoleId)))
        .limit(1);
      // The Admin role is given deliberately from Settings → Team, never through hiring.
      if (!role || role.key === 'owner') {
        throw new AppError('VALIDATION', 'Choose the login they will get.', {
          loginRoleId: ['Choose Staff, Manager or no login'],
        });
      }
    }
    const [employee] = await tx
      .insert(employees)
      .values({
        tenantId: ctx.tenantId,
        loginRoleId: input.loginRoleId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: employees.id, employeeNumber: employees.employeeNumber });
    if (!employee) throw new AppError('INTERNAL', 'Could not save the new hire.');

    const [contract] = await tx
      .insert(employmentContracts)
      .values({
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        positionTitle: input.positionTitle,
        currency: ctx.tenant.currency,
        awardName: contractor ? null : input.awardName,
        classificationRef: contractor ? null : input.classificationRef,
        rateSource,
        rateSchedule,
        probationMonths: contractor ? null : input.probationMonths,
        statements: statementsFor(ctx.tenant.country, input.employmentType),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        ...terms,
      })
      .returning({ id: employmentContracts.id });
    if (!contract) throw new AppError('INTERNAL', 'Could not save the contract.');

    await audit(tx, ctx, {
      action: 'create',
      entityType: 'employee',
      entityId: employee.id,
      // The warnings shown at the time are part of the record of what the admin decided.
      context: {
        contractId: contract.id,
        employeeNumber: employee.employeeNumber,
        employmentType: input.employmentType,
        rateSource,
        warnings,
        loginRoleId: input.loginRoleId,
      },
    });
    return {
      employeeId: employee.id,
      employeeNumber: employee.employeeNumber,
      contractId: contract.id,
      warnings,
    };
  });
}

function offerEmail(input: {
  firstName: string;
  employerName: string;
  color: string | null;
  link: string;
}) {
  return {
    subject: `Your offer from ${input.employerName}`,
    ...renderEmail({
      sender: { kind: 'business', name: input.employerName, color: input.color },
      preheader: `${input.employerName} has sent you an offer to review and accept.`,
      heading: `Your offer from ${input.employerName}`,
      blocks: [
        { type: 'paragraph', text: `Hi ${input.firstName},` },
        {
          type: 'paragraph',
          text: `${input.employerName} has sent you an offer to review and accept. You can read it in full, ask questions before you decide, and accept it online.`,
        },
        { type: 'button', label: 'Review your offer', url: input.link },
        {
          type: 'note',
          text: `This link is personal to you and expires in ${LINK_DAYS} days. Please don't forward it.`,
        },
      ],
      reason: `You received this because ${input.employerName} is offering you a role.`,
    }),
  };
}

/**
 * Freezes the wording, issues a fresh one-time link and emails it. Sending again replaces the
 * previous link. The link is returned so the admin can pass it on when email is not set up or
 * the message could not be sent; it is the only time the secret exists outside the email.
 */
export async function sendContract(
  ctx: TenantContext,
  contractId: string,
): Promise<{ emailed: true } | { emailed: false; link: string }> {
  requirePermission(ctx, 'employees.manage');
  const { token, hash } = createLinkToken();

  const sent = await withRls(ctx, async (tx) => {
    const [contract] = await tx
      .select()
      .from(employmentContracts)
      .where(
        and(
          eq(employmentContracts.tenantId, ctx.tenantId),
          eq(employmentContracts.id, contractId),
          isNull(employmentContracts.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!contract) throw new AppError('NOT_FOUND', 'That contract was not found.');
    if (contract.status !== 'draft' && contract.status !== 'sent') {
      throw new AppError('CONFLICT', 'This contract has already been answered or withdrawn.');
    }
    const [employee] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, contract.employeeId)))
      .limit(1);
    if (!employee) throw new AppError('NOT_FOUND', 'That contract was not found.');

    const now = new Date();
    await tx
      .update(employmentContracts)
      .set({
        status: 'sent',
        // Wording is frozen the first time it is sent; a re-send delivers the same text.
        body: contract.body ?? contractWording(contract, employee, ctx.tenant.name),
        tokenHash: hash,
        tokenExpiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000),
        sentAt: now,
        sentBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .where(
        and(eq(employmentContracts.tenantId, ctx.tenantId), eq(employmentContracts.id, contractId)),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employment_contract',
      entityId: contractId,
      changes: { status: [contract.status, 'sent'] },
    });
    return { email: employee.email, firstName: employee.firstName };
  });

  const link = `${serverEnv().APP_URL}/offer/${token}`;
  const result = await sendEmail({
    to: sent.email,
    ...offerEmail({
      firstName: sent.firstName,
      employerName: ctx.tenant.name,
      color: ctx.tenant.primaryColor,
      link,
    }),
  });
  // Once the offer is in the hire's inbox, the admin holding the link too could accept it, and
  // enter bank details, in the hire's name.
  return result.sent ? { emailed: true } : { emailed: false, link };
}

export async function withdrawContract(
  ctx: TenantContext,
  contractId: string,
): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const [contract] = await tx
      .select({ status: employmentContracts.status })
      .from(employmentContracts)
      .where(
        and(
          eq(employmentContracts.tenantId, ctx.tenantId),
          eq(employmentContracts.id, contractId),
          isNull(employmentContracts.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!contract) throw new AppError('NOT_FOUND', 'That contract was not found.');
    if (contract.status !== 'sent') {
      throw new AppError(
        'CONFLICT',
        'Only a contract that is out for acceptance can be withdrawn.',
      );
    }
    await tx
      .update(employmentContracts)
      .set({ status: 'withdrawn', tokenHash: null, tokenExpiresAt: null, updatedBy: ctx.userId })
      .where(
        and(eq(employmentContracts.tenantId, ctx.tenantId), eq(employmentContracts.id, contractId)),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employment_contract',
      entityId: contractId,
      changes: { status: ['sent', 'withdrawn'] },
    });
    return { id: contractId };
  });
}

/**
 * Decrypts one person's tax, bank and super numbers for someone allowed to see them. Every
 * reveal is written to the audit log before the values are returned.
 */
export async function revealPayrollDetails(
  ctx: TenantContext,
  employeeId: string,
): Promise<RevealedPayroll> {
  requirePermission(ctx, 'employees.view_sensitive');
  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(employeePayrollDetails)
      .where(
        and(
          eq(employeePayrollDetails.tenantId, ctx.tenantId),
          eq(employeePayrollDetails.employeeId, employeeId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', 'No payroll details have been submitted.');

    await audit(tx, ctx, {
      action: 'view_sensitive',
      entityType: 'employee_payroll_details',
      entityId: employeeId,
    });
    const read = (ciphertext: string | null, field: string) =>
      ciphertext ? decryptField(ciphertext, payrollBinding(ctx.tenantId, employeeId, field)) : null;
    return {
      taxFileNumber: read(row.taxFileNumberCiphertext, 'tfn'),
      bankBsb: read(row.bankBsbCiphertext, 'bsb'),
      bankAccount: read(row.bankAccountCiphertext, 'account'),
      superMemberNumber: read(row.superMemberCiphertext, 'super'),
    };
  });
}

/**
 * Reads the award's rates again for a contract and stores them beside it. The contract's own
 * terms and wording do not change: this only updates what the pay is compared with, so a rate
 * that was lawful when agreed is flagged if the award has since moved above it.
 */
export async function refreshAwardRates(
  ctx: TenantContext,
  contractId: string,
): Promise<{ minimumHourly: string | null; fetchedOn: string }> {
  requirePermission(ctx, 'employees.manage');
  const [contract] = await withRls(ctx, (tx) =>
    tx
      .select({
        id: employmentContracts.id,
        employmentType: employmentContracts.employmentType,
        awardCode: employmentContracts.awardCode,
        classificationRef: employmentContracts.classificationRef,
      })
      .from(employmentContracts)
      .where(
        and(
          eq(employmentContracts.tenantId, ctx.tenantId),
          eq(employmentContracts.id, contractId),
          isNull(employmentContracts.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!contract) throw new AppError('NOT_FOUND', 'That contract was not found.');
  if (contract.employmentType === 'contractor' || !contract.awardCode) {
    throw new AppError('CONFLICT', 'No award is recorded on this contract.');
  }
  if (!contract.classificationRef) {
    throw new AppError(
      'CONFLICT',
      'This contract’s classification was typed in, not chosen from the pay database, so its rates cannot be looked up.',
    );
  }
  if (!isFairWorkConfigured()) {
    throw new AppError('CONFLICT', 'The Fair Work pay database is not connected to this system.');
  }
  const schedule = await getAwardRates(
    contract.awardCode,
    contract.classificationRef,
    contract.employmentType,
  );
  if (!schedule) {
    throw new AppError(
      'CONFLICT',
      'The pay database has no current rate for this classification. It may have been renamed in the award.',
    );
  }
  return withRls(ctx, async (tx) => {
    await tx
      .update(employmentContracts)
      .set({ rateSchedule: schedule, updatedBy: ctx.userId })
      .where(
        and(
          eq(employmentContracts.tenantId, ctx.tenantId),
          eq(employmentContracts.id, contract.id),
        ),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employment_contract',
      entityId: contract.id,
      context: { awardRatesRead: schedule.fetchedOn, minimumHourly: schedule.minimumHourly },
    });
    return { minimumHourly: schedule.minimumHourly, fetchedOn: schedule.fetchedOn };
  });
}
