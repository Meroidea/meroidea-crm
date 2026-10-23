import { describe, expect, it } from 'vitest';

import {
  studyLoanCents,
  taxCents,
  weeklyEarningsCents,
  withholdingFor,
  type PayFrequency,
  type TaxDeclaration,
  type TaxScale,
} from '@/modules/payroll/payg';

// The "Sample data" tables of Schedule 1 in F2026L00716: earnings, then scales 1, 2, 3, 5, 6.
import samples from '../fixtures/ato-schedule1-2026-samples.json';

const cents = (amount: string) => Math.round(Number(amount) * 100);
const columns: TaxScale[] = [1, 2, 3, 5, 6];

describe('PAYG withholding matches every row of the ATO sample data', () => {
  for (const frequency of ['weekly', 'fortnightly', 'monthly'] as PayFrequency[]) {
    const rows = samples[frequency as keyof typeof samples];
    it(`has the ${frequency} sample rows`, () => {
      expect(rows.length).toBe(48);
    });
    for (const [earnings, ...expected] of rows) {
      it(`${frequency} earnings of $${earnings}`, () => {
        const actual = columns.map((scale) => taxCents(cents(earnings!), frequency, scale));
        expect(actual).toEqual(expected.map(cents));
      });
    }
  }
});

describe('the worked examples in Schedule 1 and Schedule 8', () => {
  it('turns earnings into weekly x the way the schedule does', () => {
    expect(weeklyEarningsCents(47759, 'weekly')).toBe(47799);
    expect(weeklyEarningsCents(129930, 'fortnightly')).toBe(64999);
    // $5,400.33 gains a cent before × 3 ÷ 13.
    expect(weeklyEarningsCents(540033, 'monthly')).toBe(124699);
  });

  it('monthly tax on $5,400.33 at scale 2 is $940 before offsets', () => {
    expect(taxCents(540033, 'monthly', 2)).toBe(94000);
  });

  it('fortnightly tax on $1,299.30 at scale 5 is $86 before offsets', () => {
    expect(taxCents(129930, 'fortnightly', 5)).toBe(8600);
  });

  it('weekly study loan component on $2,608.36 with the threshold is $193', () => {
    expect(studyLoanCents(260836, 'weekly', true)).toBe(19300);
  });

  it('fortnightly study loan component on $4,409.75 with the threshold is $260', () => {
    expect(studyLoanCents(440975, 'fortnightly', true)).toBe(26000);
  });

  it('monthly study loan component on $10,627.88 without the threshold is $979', () => {
    expect(studyLoanCents(1062788, 'monthly', false)).toBe(97900);
  });

  it('matches the HELP bonus example in Schedule 1 (scale 2, weekly)', () => {
    expect(taxCents(140000, 'weekly', 2)).toBe(26700);
    expect(studyLoanCents(140000, 'weekly', true)).toBe(1000);
    expect(taxCents(141700, 'weekly', 2)).toBe(27200);
    expect(studyLoanCents(141700, 'weekly', true)).toBe(1200);
  });

  it('withholds a study loan component only on earnings over the repayment threshold', () => {
    expect(studyLoanCents(133600, 'weekly', true)).toBe(0);
    // Marginal: 15% of the excess over the threshold, so $1,400.99 gives 0.15x − 200.5615 ≈ $10.
    expect(studyLoanCents(140000, 'weekly', true)).toBe(1000);
    expect(studyLoanCents(98600, 'weekly', false)).toBe(0);
    expect(studyLoanCents(105000, 'weekly', false)).toBe(1000);
  });
});

describe('withholdingFor', () => {
  const declared: TaxDeclaration = {
    hasTaxFileNumber: true,
    taxResident: true,
    claimsTaxFreeThreshold: true,
    hasStudyLoan: false,
  };
  const base = {
    grossCents: 129930,
    weeks: 2,
    paymentDate: '2026-10-23',
    employmentType: 'casual',
    declaration: declared,
  };

  it('uses scale 2 for a resident who claims the tax-free threshold', () => {
    expect(withholdingFor(base)).toEqual({
      calculated: true,
      cents: taxCents(129930, 'fortnightly', 2),
      scale: 2,
      studyLoanCents: 0,
    });
  });

  it('uses scale 1 without the tax-free threshold and scale 3 for a foreign resident', () => {
    const scaleOf = (declaration: TaxDeclaration) => {
      const result = withholdingFor({ ...base, declaration });
      return result.calculated ? result.scale : null;
    };
    expect(scaleOf({ ...declared, claimsTaxFreeThreshold: false })).toBe(1);
    expect(scaleOf({ ...declared, taxResident: false })).toBe(3);
  });

  it('adds the study loan component to the tax', () => {
    const result = withholdingFor({
      ...base,
      grossCents: 440975,
      declaration: { ...declared, hasStudyLoan: true },
    });
    expect(result).toMatchObject({
      calculated: true,
      cents: taxCents(440975, 'fortnightly', 2) + 26000,
      studyLoanCents: 26000,
    });
  });

  it('leaves tax to a person when it cannot be worked out safely', () => {
    const reasons = [
      { declaration: null },
      { declaration: { ...declared, taxResident: null } },
      { declaration: { ...declared, hasTaxFileNumber: false } },
      { employmentType: 'contractor' },
      { weeks: 4 },
      { paymentDate: '2026-06-30' },
      { paymentDate: '2027-07-01' },
    ].map((change) => withholdingFor({ ...base, ...change }));
    for (const result of reasons) expect(result.calculated).toBe(false);
  });

  it('never withholds more than the gross pay', () => {
    const result = withholdingFor({ ...base, grossCents: 0 });
    expect(result).toMatchObject({ calculated: true, cents: 0 });
  });
});
