import type { EmployerSnapshot } from '@/modules/settings/business';

import type { PayslipLine } from './lines';

export type PayslipShift = { date: string; start: string; end: string; minutes: number };

export type PayslipRow = {
  id: string;
  status: 'draft' | 'released';
  employeeId: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  minutes: number;
  hourlyRate: string;
  gross: string;
  taxWithheld: string;
  net: string;
  superAmount: string;
  currency: string;
};

export type PayslipDetail = PayslipRow & {
  /** The reader's own released payslip, as opposed to one they see because they run payroll. */
  mine: boolean;
  /** Null on payslips made before Employee IDs existed. */
  employeeNumber: number | null;
  employerDetails: string | null;
  positionTitle: string | null;
  superRate: string;
  superFundName: string | null;
  shifts: PayslipShift[];
  /** The employee's own count of payslips; null on payslips made before it was kept. */
  number: number | null;
  /** The business as it described itself when the payslip was made. */
  employer: EmployerSnapshot | null;
  employmentType: string | null;
  classification: string | null;
  /** What the pay is made up of. Empty on payslips made before lines were kept. */
  lines: PayslipLine[];
  yearToDate: YearToDate;
};

/** Totals from the start of the financial year up to and including this payslip. */
export type YearToDate = {
  /** The first day of the financial year the payment date falls in. */
  from: string;
  gross: string;
  taxWithheld: string;
  net: string;
  superAmount: string;
  /** Amount so far this year for each line title on this payslip. */
  byLine: Record<string, string>;
};

/**
 * The first day of the financial year a payment falls in: 1 July in Australia, otherwise
 * 1 January.
 */
export function financialYearStart(paymentDate: string, country: string | null): string {
  const year = Number(paymentDate.slice(0, 4));
  if (country !== 'AU') return `${year}-01-01`;
  return paymentDate.slice(5) >= '07-01' ? `${year}-07-01` : `${year - 1}-07-01`;
}

export type PayRunRoster = {
  id: string;
  startsOn: string;
  endsOn: string;
  status: 'draft' | 'published';
  authorisedAt: Date | null;
  payslips: number;
  released: number;
};

/** Someone on the roster who could not be paid from it, and why. */
export type SkippedPerson = { name: string; reason: string };

/** "7h 30m" from worked minutes. */
export function formatWorked(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
