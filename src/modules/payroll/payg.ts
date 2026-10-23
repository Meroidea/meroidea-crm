/**
 * PAYG withholding worked out with the ATO's formulas (ADR-055): Schedule 1 (NAT 1004) for the
 * tax and Schedule 8 for the study and training support loans component, as made in the
 * Taxation Administration (Withholding Schedules) Instrument 2026 (F2026L00716) for payments from
 * 1 July 2026.
 *
 * Every amount is integer cents, and the coefficients are held in ten-thousandths, so the
 * schedule's "y = ax − b" is exact integer arithmetic. Medicare levy adjustments, tax offsets,
 * working holiday makers (Schedule 15) and the extra withholding for a 53rd or 27th pay are not
 * applied: those need declarations this system does not collect.
 */

export type PayFrequency = 'weekly' | 'fortnightly' | 'monthly';

/**
 * 1 no tax-free threshold · 2 tax-free threshold · 3 foreign resident · 5 and 6 full and half
 * Medicare levy exemption. Scale 4 (no TFN) is left to a person: see withholdingFor.
 */
export type TaxScale = 1 | 2 | 3 | 5 | 6;

/** The payments these coefficients are for. A payment outside them is not calculated. */
export const SCHEDULE_PERIOD = { from: '2026-07-01', to: '2027-06-30' } as const;

/** [weekly earnings less than (whole dollars, null for "& over"), a, b], a and b × 10,000. */
type Band = readonly [number | null, number, number];

const NONE = 0;

const SCALES: Record<TaxScale, readonly Band[]> = {
  1: [
    [188, 1500, 1500],
    [371, 2084, 110185],
    [515, 1790, 1066],
    [932, 3227, 741674],
    [2246, 3200, 716508],
    [3303, 3900, 2288816],
    [null, 4700, 4931893],
  ],
  2: [
    [362, NONE, NONE],
    [538, 1500, 543462],
    [673, 2500, 1082135],
    [721, 1700, 543473],
    [865, 1790, 608377],
    [1282, 3227, 1851935],
    [2596, 3200, 1817319],
    [3653, 3900, 3634627],
    [null, 4700, 6557704],
  ],
  3: [
    [2596, 3000, 3000],
    [3653, 3700, 1817308],
    [null, 4500, 4740385],
  ],
  5: [
    [362, NONE, NONE],
    [721, 1500, 543462],
    [865, 1590, 608365],
    [1282, 3027, 1851923],
    [2596, 3000, 1817308],
    [3653, 3700, 3634615],
    [null, 4500, 6557692],
  ],
  6: [
    [362, NONE, NONE],
    [721, 1500, 543462],
    [865, 1590, 608365],
    [908, 3027, 1851923],
    [1135, 3527, 2306135],
    [1282, 3127, 1851923],
    [2596, 3100, 1817308],
    [3653, 3800, 3634615],
    [null, 4600, 6557692],
  ],
};

/** Schedule 8: study and training support loans component. */
const STUDY_LOAN: Record<'threshold' | 'noThreshold', readonly Band[]> = {
  // Also used for foreign residents.
  threshold: [
    [1337, NONE, NONE],
    [2494, 1500, 2005615],
    [3577, 1700, 2504527],
    [null, 1000, 0],
  ],
  noThreshold: [
    [987, NONE, NONE],
    [2144, 1500, 1480615],
    [2727, 1700, 1909527],
    [null, 1000, 0],
  ],
};

/**
 * "x": the weekly equivalent of the period's earnings in whole dollars, plus 99 cents, in cents.
 * Monthly earnings ending in 33 cents gain a cent first, as the schedule says.
 */
export function weeklyEarningsCents(grossCents: number, frequency: PayFrequency): number {
  let dollars: number;
  if (frequency === 'weekly') dollars = Math.floor(grossCents / 100);
  else if (frequency === 'fortnightly') dollars = Math.floor(grossCents / 200);
  else {
    const adjusted = grossCents % 100 === 33 ? grossCents + 1 : grossCents;
    dollars = Math.floor((adjusted * 3) / 1300);
  }
  return dollars * 100 + 99;
}

/** The weekly amount for x, rounded to the nearest dollar with 50 cents rounding up. */
function weeklyDollars(xCents: number, bands: readonly Band[]): number {
  const band = bands.find(([below]) => below === null || xCents < below * 100);
  if (!band) return 0;
  const [, a, b] = band;
  // a × x − b in millionths of a dollar: (a/10⁴)(x/10²) − b/10⁴.
  const millionths = a * xCents - b * 100;
  return Math.max(0, Math.floor((millionths + 500_000) / 1_000_000));
}

/** A rounded weekly amount turned into the period's amount, in cents. */
function forPeriod(weekly: number, frequency: PayFrequency): number {
  if (frequency === 'weekly') return weekly * 100;
  if (frequency === 'fortnightly') return weekly * 200;
  // × 13 ÷ 3 to the nearest dollar; a third never lands on exactly 50 cents.
  return Math.floor((weekly * 26 + 3) / 6) * 100;
}

export function taxCents(grossCents: number, frequency: PayFrequency, scale: TaxScale): number {
  if (grossCents <= 0) return 0;
  return forPeriod(
    weeklyDollars(weeklyEarningsCents(grossCents, frequency), SCALES[scale]),
    frequency,
  );
}

export function studyLoanCents(
  grossCents: number,
  frequency: PayFrequency,
  claimsTaxFreeThreshold: boolean,
): number {
  if (grossCents <= 0) return 0;
  const bands = claimsTaxFreeThreshold ? STUDY_LOAN.threshold : STUDY_LOAN.noThreshold;
  return forPeriod(weeklyDollars(weeklyEarningsCents(grossCents, frequency), bands), frequency);
}

/** What a person told their employer on their tax file number declaration. */
export type TaxDeclaration = {
  hasTaxFileNumber: boolean;
  taxResident: boolean | null;
  claimsTaxFreeThreshold: boolean | null;
  hasStudyLoan: boolean | null;
};

export type Withholding =
  | { calculated: true; cents: number; scale: TaxScale; studyLoanCents: number }
  | { calculated: false; reason: string };

/**
 * The amount to withhold from one payslip, or why it has to be entered by hand. Anything the
 * declaration leaves unanswered is left to a person rather than guessed: a guess at residency or
 * the tax-free threshold changes the figure by hundreds of dollars.
 */
export function withholdingFor(input: {
  grossCents: number;
  /** Length of the pay period in weeks. */
  weeks: number;
  paymentDate: string;
  employmentType: string;
  declaration: TaxDeclaration | null;
}): Withholding {
  const { grossCents, declaration } = input;
  if (input.employmentType === 'contractor') {
    return {
      calculated: false,
      reason:
        'Is a contractor, so no tax is withheld unless you have a voluntary agreement. Enter any amount by hand.',
    };
  }
  if (input.paymentDate < SCHEDULE_PERIOD.from || input.paymentDate > SCHEDULE_PERIOD.to) {
    return {
      calculated: false,
      reason:
        'The ATO tax tables in Meroidea cover payments from 1 July 2026 to 30 June 2027. Enter the tax by hand.',
    };
  }
  const frequency: PayFrequency | null =
    input.weeks === 1 ? 'weekly' : input.weeks === 2 ? 'fortnightly' : null;
  if (!frequency) {
    return {
      calculated: false,
      reason: 'The pay period is not a week or a fortnight. Enter the tax by hand.',
    };
  }
  if (
    !declaration ||
    declaration.taxResident === null ||
    declaration.claimsTaxFreeThreshold === null
  ) {
    return {
      calculated: false,
      reason:
        'Has not completed their tax file number declaration in Meroidea. Enter the tax by hand.',
    };
  }
  if (!declaration.hasTaxFileNumber) {
    return {
      calculated: false,
      reason: `Has no tax file number on record. Unless they applied for one in the last 28 days, withhold ${
        declaration.taxResident ? '47%' : '45%'
      } of their pay, ignoring cents. Enter it by hand.`,
    };
  }

  const scale: TaxScale = !declaration.taxResident ? 3 : declaration.claimsTaxFreeThreshold ? 2 : 1;
  const tax = taxCents(grossCents, frequency, scale);
  // Foreign residents use the tax-free threshold column of Schedule 8.
  const loan = declaration.hasStudyLoan
    ? studyLoanCents(
        grossCents,
        frequency,
        !declaration.taxResident || declaration.claimsTaxFreeThreshold,
      )
    : 0;
  return {
    calculated: true,
    cents: Math.min(grossCents, tax + loan),
    scale,
    studyLoanCents: loan,
  };
}
