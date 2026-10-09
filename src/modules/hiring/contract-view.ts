import type { employees, employmentContracts } from '@/db/schema';

import type { Statement } from './compliance';
import { renderContract } from './templates';
import type { ContractDetail } from './types';

type ContractRow = typeof employmentContracts.$inferSelect;
type EmployeeRow = Pick<typeof employees.$inferSelect, 'firstName' | 'lastName'>;

/** The wording for a contract's current terms. Used for the preview and frozen at send time. */
export function contractWording(
  contract: ContractRow,
  employee: EmployeeRow,
  employerName: string,
): string {
  return renderContract({
    employerName,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employmentType: contract.employmentType,
    positionTitle: contract.positionTitle,
    startDate: contract.startDate,
    endDate: contract.endDate,
    hoursPerWeek: contract.hoursPerWeek,
    payBasis: contract.payBasis,
    payRate: contract.payRate,
    currency: contract.currency,
    awardName: contract.awardName,
    awardCode: contract.awardCode,
    classification: contract.classification,
    contractorAbn: contract.contractorAbn,
    probationMonths: contract.probationMonths,
    statements: contract.statements as Statement[],
  });
}

export function toContractDetail(
  contract: ContractRow,
  employee: EmployeeRow,
  employerName: string,
): ContractDetail {
  return {
    id: contract.id,
    status: contract.status,
    employmentType: contract.employmentType,
    positionTitle: contract.positionTitle,
    startDate: contract.startDate,
    endDate: contract.endDate,
    hoursPerWeek: contract.hoursPerWeek,
    payBasis: contract.payBasis,
    payRate: contract.payRate,
    currency: contract.currency,
    awardCode: contract.awardCode,
    awardName: contract.awardName,
    classification: contract.classification,
    minimumRate: contract.minimumRate,
    rateSource: contract.rateSource,
    belowMinimumReason: contract.belowMinimumReason,
    contractorAbn: contract.contractorAbn,
    probationMonths: contract.probationMonths,
    body: contract.body ?? contractWording(contract, employee, employerName),
    statements: contract.statements as Statement[],
    sentAt: contract.sentAt,
    viewedAt: contract.viewedAt,
    acceptedAt: contract.acceptedAt,
    acceptedName: contract.acceptedName,
    declinedAt: contract.declinedAt,
    tokenExpiresAt: contract.tokenExpiresAt,
  };
}
