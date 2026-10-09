import { describe, expect, it } from 'vitest';

import {
  checkOffer,
  isBelowMinimum,
  statementsFor,
  type OfferTerms,
} from '@/modules/hiring/compliance';
import {
  isValidAbn,
  isValidBsb,
  isValidTaxFileNumber,
  maskTail,
} from '@/modules/hiring/identifiers';
import { createHireSchema, payrollDetailsSchema } from '@/modules/hiring/schemas';
import { renderContract } from '@/modules/hiring/templates';

const terms = (overrides: Partial<OfferTerms> = {}): OfferTerms => ({
  employmentType: 'full_time',
  startDate: '2031-03-03',
  endDate: null,
  hoursPerWeek: '38',
  payBasis: 'hourly',
  payRate: '32.00',
  awardCode: 'MA000002',
  classification: 'Level 2',
  minimumRate: '28.12',
  belowMinimumReason: null,
  contractorAbn: null,
  ...overrides,
});

describe('statements a new starter must be given (Australia)', () => {
  it('gives every employee the Fair Work Information Statement', () => {
    expect(statementsFor('AU', 'full_time').map((s) => s.key)).toEqual(['fwis']);
    expect(statementsFor('AU', 'part_time').map((s) => s.key)).toEqual(['fwis']);
  });

  it('adds the casual and fixed-term statements for those types', () => {
    expect(statementsFor('AU', 'casual').map((s) => s.key)).toEqual(['fwis', 'ceis']);
    expect(statementsFor('AU', 'fixed_term').map((s) => s.key)).toEqual(['fwis', 'ftcis']);
  });

  it('gives a contractor none, and claims nothing for another country', () => {
    expect(statementsFor('AU', 'contractor')).toEqual([]);
    expect(statementsFor('NZ', 'casual')).toEqual([]);
  });
});

describe('pay against the minimum', () => {
  it('compares an hourly rate exactly, to the cent', () => {
    expect(isBelowMinimum(terms({ payRate: '28.12' }))).toBe(false);
    expect(isBelowMinimum(terms({ payRate: '28.11' }))).toBe(true);
  });

  it('converts an annual salary using the agreed weekly hours', () => {
    // 28.12 × 52 × 38 = 55,565.12 a year.
    expect(isBelowMinimum(terms({ payBasis: 'annual', payRate: '55565.12' }))).toBe(false);
    expect(isBelowMinimum(terms({ payBasis: 'annual', payRate: '55565.11' }))).toBe(true);
    // Part-time at 19 hours needs half as much.
    expect(
      isBelowMinimum(terms({ payBasis: 'annual', payRate: '27782.56', hoursPerWeek: '19' })),
    ).toBe(false);
  });

  it('blocks pay under the minimum unless a lawful reason is recorded', () => {
    expect(checkOffer('AU', terms({ payRate: '20.00' })).errors.payRate).toBeDefined();
    expect(
      checkOffer('AU', terms({ payRate: '20.00', belowMinimumReason: 'Junior rate, 18 years' }))
        .errors.payRate,
    ).toBeUndefined();
  });

  it('warns, rather than passing silently, when the minimum was never checked', () => {
    const { errors, warnings } = checkOffer('AU', terms({ minimumRate: null }));
    expect(errors).toEqual({});
    expect(warnings.join(' ')).toMatch(/not checked/);
  });
});

describe('rules by employment type', () => {
  it('needs an end date for fixed-term work and warns past two years', () => {
    expect(checkOffer('AU', terms({ employmentType: 'fixed_term' })).errors.endDate).toBeDefined();
    const long = checkOffer('AU', terms({ employmentType: 'fixed_term', endDate: '2033-06-30' }));
    expect(long.errors).toEqual({});
    expect(long.warnings.join(' ')).toMatch(/two years/);
  });

  it('needs agreed hours under 38 for part-time', () => {
    expect(
      checkOffer('AU', terms({ employmentType: 'part_time', hoursPerWeek: null })).errors
        .hoursPerWeek,
    ).toBeDefined();
    expect(
      checkOffer('AU', terms({ employmentType: 'part_time', hoursPerWeek: '38' })).errors
        .hoursPerWeek,
    ).toBeDefined();
    expect(
      checkOffer('AU', terms({ employmentType: 'part_time', hoursPerWeek: '20' })).errors,
    ).toEqual({});
  });

  it('pays casuals by the hour and reminds about the loading', () => {
    const casual = terms({ employmentType: 'casual', hoursPerWeek: null });
    expect(
      checkOffer('AU', { ...casual, payBasis: 'annual', payRate: '60000' }).errors.payBasis,
    ).toBeDefined();
    expect(checkOffer('AU', casual).warnings.join(' ')).toMatch(/casual loading/);
  });

  it('needs a valid ABN and an end date for a contractor, and warns about sham contracting', () => {
    const contractor = terms({
      employmentType: 'contractor',
      awardCode: null,
      classification: null,
    });
    const missing = checkOffer('AU', contractor);
    expect(missing.errors.contractorAbn).toBeDefined();
    expect(missing.errors.endDate).toBeDefined();
    const valid = checkOffer('AU', {
      ...contractor,
      contractorAbn: '51 824 753 556',
      endDate: '2031-09-01',
    });
    expect(valid.errors).toEqual({});
    expect(valid.warnings.join(' ')).toMatch(/sham contracting/);
  });

  it('needs a classification once an award is named', () => {
    expect(checkOffer('AU', terms({ classification: null })).errors.classification).toBeDefined();
  });
});

describe('identifier checks', () => {
  it('accepts tax file numbers that pass the check digit and rejects ones that do not', () => {
    expect(isValidTaxFileNumber('123 456 782')).toBe(true);
    expect(isValidTaxFileNumber('123 456 789')).toBe(false);
    expect(isValidTaxFileNumber('12345')).toBe(false);
  });

  it('checks ABNs and BSBs', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('51 824 753 557')).toBe(false);
    expect(isValidBsb('062-000')).toBe(true);
    expect(isValidBsb('0620')).toBe(false);
  });

  it('masks all but the last three digits', () => {
    expect(maskTail('123456782')).toBe('••••••782');
  });
});

describe('form schemas', () => {
  const hire = {
    firstName: 'Sam',
    lastName: 'Example',
    email: 'sam@example.com',
    employmentType: 'casual',
    positionTitle: 'Assistant',
    startDate: '2031-03-03',
    payBasis: 'hourly',
    payRate: '35.5',
  };

  it('treats blank optional fields as absent and accepts its own output', () => {
    const once = createHireSchema.parse({
      ...hire,
      endDate: '',
      hoursPerWeek: '',
      probationMonths: '',
    });
    expect(once).toMatchObject({ endDate: null, hoursPerWeek: null, probationMonths: null });
    expect(createHireSchema.parse(once)).toEqual(once);
  });

  it('rejects money with more than two decimals', () => {
    expect(createHireSchema.safeParse({ ...hire, payRate: '35.555' }).success).toBe(false);
  });

  it('allows a blank tax file number but not an invalid one', () => {
    const base = {
      token: 'a'.repeat(43),
      taxResident: 'yes',
      claimsTaxFreeThreshold: 'yes',
      hasStudyLoan: 'no',
      bankAccountName: 'Sam Example',
      bankBsb: '062-000',
      bankAccount: '1234 5678',
      superFundName: 'Example Super',
    };
    expect(payrollDetailsSchema.parse({ ...base, taxFileNumber: '' }).taxFileNumber).toBe('');
    expect(payrollDetailsSchema.parse({ ...base, taxFileNumber: '123 456 782' })).toMatchObject({
      taxFileNumber: '123456782',
      bankBsb: '062000',
      bankAccount: '12345678',
    });
    expect(payrollDetailsSchema.safeParse({ ...base, taxFileNumber: '123456789' }).success).toBe(
      false,
    );
  });
});

describe('contract wording', () => {
  const data = {
    employerName: 'Example Pty Ltd',
    employeeName: 'Sam Example',
    employmentType: 'casual' as const,
    positionTitle: 'Assistant',
    startDate: '2031-03-03',
    endDate: null,
    hoursPerWeek: null,
    payBasis: 'hourly' as const,
    payRate: '35.50',
    currency: 'AUD',
    awardName: 'Example Award 2020',
    awardCode: 'MA000002',
    classification: 'Level 2',
    contractorAbn: null,
    probationMonths: null,
    statements: statementsFor('AU', 'casual'),
  };

  it('states the terms, the award and the statements, and marks itself as a template', () => {
    const body = renderContract(data);
    expect(body).toContain('Sam Example');
    expect(body).toContain('$35.50 per hour');
    expect(body).toContain('casual loading');
    expect(body).toContain('Example Award 2020 (MA000002), classification: Level 2');
    expect(body).toContain('Casual Employment Information Statement');
    expect(body).toContain('STARTER TEMPLATE');
  });

  it('writes a contractor agreement without employee entitlements', () => {
    const body = renderContract({
      ...data,
      employmentType: 'contractor',
      contractorAbn: '51824753556',
      endDate: '2031-09-01',
      statements: [],
    });
    expect(body).toContain('You are not our employee');
    expect(body).toContain('ABN 51824753556');
    expect(body).not.toContain('National Employment Standards');
  });
});
