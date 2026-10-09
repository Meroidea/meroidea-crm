import type { FieldErrors } from '@/lib/errors';

import { isValidAbn } from './identifiers';

/**
 * Employment rules that depend on the workspace's country. Only Australia is implemented; any
 * other country gets the checks that are true everywhere (dates in order, pay present) and no
 * statutory statements. These are guard rails, not legal advice: they stop the steps the law
 * requires from being skipped, but cannot confirm a classification or a contract is right.
 */

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'casual',
  'fixed_term',
  'contractor',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  casual: 'Casual',
  fixed_term: 'Fixed-term',
  contractor: 'Independent contractor',
};

export const EMPLOYMENT_TYPE_HINTS: Record<EmploymentType, string> = {
  full_time: 'Ongoing, around 38 ordinary hours a week',
  part_time: 'Ongoing, fewer than 38 agreed hours a week',
  casual: 'No firm advance commitment to ongoing work',
  fixed_term: 'Ends on a set date',
  contractor: 'Runs their own business; not an employee',
};

export type Statement = { key: string; title: string; url: string };

const AU_STATEMENTS = {
  fwis: {
    key: 'fwis',
    title: 'Fair Work Information Statement',
    url: 'https://www.fairwork.gov.au/fwis',
  },
  ceis: {
    key: 'ceis',
    title: 'Casual Employment Information Statement',
    url: 'https://www.fairwork.gov.au/ceis',
  },
  ftcis: {
    key: 'ftcis',
    title: 'Fixed Term Contract Information Statement',
    url: 'https://www.fairwork.gov.au/ftcis',
  },
} satisfies Record<string, Statement>;

/** Statements an employer must give a new starter, by employment type. */
export function statementsFor(country: string | null, type: EmploymentType): Statement[] {
  if (country !== 'AU' || type === 'contractor') return [];
  if (type === 'casual') return [AU_STATEMENTS.fwis, AU_STATEMENTS.ceis];
  if (type === 'fixed_term') return [AU_STATEMENTS.fwis, AU_STATEMENTS.ftcis];
  return [AU_STATEMENTS.fwis];
}

export type OfferTerms = {
  employmentType: EmploymentType;
  startDate: string;
  endDate: string | null;
  /** Decimal strings throughout: money and hours are never floating-point here. */
  hoursPerWeek: string | null;
  payBasis: 'hourly' | 'annual';
  payRate: string;
  awardCode: string | null;
  classification: string | null;
  /** Minimum hourly rate for the classification, when one is known. */
  minimumRate: string | null;
  belowMinimumReason: string | null;
  contractorAbn: string | null;
};

/** "24.95" → 2495n. Callers have already validated the format. */
const hundredths = (value: string): bigint => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
};

const FULL_TIME_HOURS = '38';

/** Whether the offered pay is under the minimum hourly rate, compared exactly in cents. */
export function isBelowMinimum(terms: OfferTerms): boolean {
  if (!terms.minimumRate) return false;
  const minimum = hundredths(terms.minimumRate);
  if (terms.payBasis === 'hourly') return hundredths(terms.payRate) < minimum;
  // Annual salary against (minimum × 52 weeks × weekly hours), all scaled by 100 to stay whole.
  const hours = hundredths(terms.hoursPerWeek ?? FULL_TIME_HOURS);
  return hundredths(terms.payRate) * 100n < minimum * 52n * hours;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Errors block the offer; warnings are shown to the admin and recorded, but the decision is
 * theirs. Anything that depends on facts the system cannot know is a warning.
 */
export function checkOffer(
  country: string | null,
  terms: OfferTerms,
): { errors: FieldErrors; warnings: string[] } {
  const errors: FieldErrors = {};
  const warnings: string[] = [];
  const australian = country === 'AU';
  const { employmentType: type } = terms;
  const hours = terms.hoursPerWeek ? Number(terms.hoursPerWeek) : null;

  if (terms.endDate && terms.endDate < terms.startDate) {
    errors.endDate = ['The end date is before the start date'];
  }
  if ((type === 'fixed_term' || type === 'contractor') && !terms.endDate) {
    errors.endDate = ['Set the date this engagement ends'];
  }
  if (type === 'part_time' && hours === null) {
    errors.hoursPerWeek = ['Set the agreed weekly hours'];
  }
  if (type === 'casual' && terms.payBasis !== 'hourly') {
    errors.payBasis = ['Casual work is paid by the hour'];
  }

  if (!australian) return { errors, warnings };

  if (type === 'contractor') {
    if (!terms.contractorAbn || !isValidAbn(terms.contractorAbn)) {
      errors.contractorAbn = ['Enter the contractor’s valid 11-digit ABN'];
    }
    warnings.push(
      'Treating an employee as a contractor is unlawful (sham contracting). Check that this person genuinely runs their own business before engaging them this way.',
    );
    return { errors, warnings };
  }

  if (type === 'part_time' && hours !== null && hours >= 38) {
    errors.hoursPerWeek = ['Part-time is fewer than 38 hours a week; choose full-time instead'];
  }
  if (type === 'full_time' && hours !== null && hours > 38) {
    warnings.push(
      'Ordinary hours for a full-time employee are 38 a week. Extra hours must be reasonable and may attract overtime under the award.',
    );
  }
  if (type === 'fixed_term' && terms.endDate && daysBetween(terms.startDate, terms.endDate) > 731) {
    warnings.push(
      'Fixed-term contracts are generally limited to two years, including renewals, unless an exception applies.',
    );
  }
  if (type === 'casual') {
    warnings.push(
      'The hourly rate for a casual must include the casual loading set by the award (commonly 25%).',
    );
  }

  if (!terms.awardCode) {
    warnings.push(
      'No award is recorded. If this role is genuinely award-free, the rate must still meet the national minimum wage.',
    );
  } else if (!terms.classification) {
    errors.classification = ['Choose the classification under the award'];
  }

  if (isBelowMinimum(terms) && !terms.belowMinimumReason) {
    errors.payRate = [
      `This is below the minimum of $${terms.minimumRate} an hour for the classification. Raise it, or record why a lower rate lawfully applies.`,
    ];
  }
  if (terms.awardCode && !terms.minimumRate) {
    warnings.push(
      'The minimum rate for this classification was not checked. Confirm the pay against the award before sending.',
    );
  }

  return { errors, warnings };
}
