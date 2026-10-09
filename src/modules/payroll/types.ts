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
  employerDetails: string | null;
  positionTitle: string | null;
  superRate: string;
  superFundName: string | null;
  shifts: PayslipShift[];
};

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
