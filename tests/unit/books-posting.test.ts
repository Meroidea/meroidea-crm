import { describe, expect, it } from 'vitest';

import {
  financialYearStart,
  formatCents,
  parseCents,
  rateBasisPoints,
  sumMoney,
  taxInInclusive,
  taxOnExclusive,
  toCents,
} from '@/modules/books/money';
import { COUNTRY_PACKS, SYSTEM_ACCOUNT_KEYS, SYSTEM_TAX_KEYS } from '@/modules/books/packs';
import {
  buildBankEntry,
  buildJournal,
  buildTransfer,
  PostingError,
  type PostingLine,
} from '@/modules/books/posting';

const BANK = 'bank';
const GST = 'gst';
const SALES = 'sales';
const RENT = 'rent';
const FEES = 'fees';
const rates = new Map([
  ['gst10', '10.00'],
  ['free', '0.00'],
]);

function totals(lines: PostingLine[]) {
  return {
    debit: sumMoney(lines.map((line) => line.debit)),
    credit: sumMoney(lines.map((line) => line.credit)),
  };
}

describe('money in cents', () => {
  it('parses dollars and cents exactly and refuses anything else', () => {
    expect(parseCents('1234.5')).toBe(123450n);
    expect(parseCents('0.01')).toBe(1n);
    expect(parseCents('12')).toBe(1200n);
    expect(parseCents('1.234')).toBeNull();
    expect(parseCents('-1')).toBeNull();
    expect(parseCents('1e3')).toBeNull();
    expect(parseCents('')).toBeNull();
  });

  it('formats cents back, keeping the sign', () => {
    expect(formatCents(123450n)).toBe('1234.50');
    expect(formatCents(-5n)).toBe('-0.05');
    expect(toCents('-12.3')).toBe(-1230n);
  });

  it('adds without floating-point drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(Array.from({ length: 1000 }, () => '0.01'))).toBe('10.00');
  });

  it('works out GST inside and on top of an amount, rounding half up', () => {
    expect(rateBasisPoints('10')).toBe(1000n);
    expect(rateBasisPoints('101')).toBeNull();
    expect(taxInInclusive(11000n, 1000n)).toBe(1000n);
    expect(taxOnExclusive(10000n, 1000n)).toBe(1000n);
    // $9.99 including GST holds 90.818… cents of GST → 91 cents.
    expect(taxInInclusive(999n, 1000n)).toBe(91n);
    // 5 cents plus 10% is half a cent of GST → rounds up to 1 cent.
    expect(taxOnExclusive(5n, 1000n)).toBe(1n);
    expect(taxOnExclusive(4n, 1000n)).toBe(0n);
  });

  it('finds the start of an Australian July–June financial year', () => {
    expect(financialYearStart('2027-03-15', 7)).toBe('2026-07-01');
    expect(financialYearStart('2026-07-01', 7)).toBe('2026-07-01');
    expect(financialYearStart('2026-06-30', 7)).toBe('2025-07-01');
    expect(financialYearStart('2026-06-30', 1)).toBe('2026-01-01');
  });
});

describe('money in and money out', () => {
  it('splits a GST-inclusive receipt into income, GST and the bank', () => {
    const lines = buildBankEntry({
      direction: 'in',
      bankAccountId: BANK,
      gstAccountId: GST,
      amountsAre: 'inclusive',
      items: [{ accountId: SALES, amount: '110.00', taxCodeId: 'gst10' }],
      taxRates: rates,
    });
    expect(lines).toEqual([
      expect.objectContaining({ accountId: BANK, debit: '110.00', credit: '0.00' }),
      expect.objectContaining({
        accountId: SALES,
        credit: '100.00',
        taxCodeId: 'gst10',
        taxAmount: '10.00',
      }),
      expect.objectContaining({ accountId: GST, credit: '10.00' }),
    ]);
    expect(totals(lines)).toEqual({ debit: '110.00', credit: '110.00' });
  });

  it('adds GST on top when amounts exclude it, and splits across accounts and rates', () => {
    const lines = buildBankEntry({
      direction: 'out',
      bankAccountId: BANK,
      gstAccountId: GST,
      amountsAre: 'exclusive',
      items: [
        { accountId: RENT, amount: '1000.00', taxCodeId: 'gst10' },
        { accountId: FEES, amount: '12.50', taxCodeId: 'free' },
      ],
      taxRates: rates,
    });
    expect(lines[0]).toMatchObject({ accountId: BANK, credit: '1112.50' });
    expect(lines.find((line) => line.accountId === GST)).toMatchObject({ debit: '100.00' });
    expect(lines.find((line) => line.accountId === FEES)).toMatchObject({
      debit: '12.50',
      taxAmount: '0.00',
    });
    expect(totals(lines)).toEqual({ debit: '1112.50', credit: '1112.50' });
  });

  it('balances to the cent on awkward amounts', () => {
    const lines = buildBankEntry({
      direction: 'out',
      bankAccountId: BANK,
      gstAccountId: GST,
      amountsAre: 'inclusive',
      items: ['9.99', '0.07', '33.33', '1234567.89'].map((amount) => ({
        accountId: RENT,
        amount,
        taxCodeId: 'gst10',
      })),
      taxRates: rates,
    });
    const { debit, credit } = totals(lines);
    expect(debit).toBe(credit);
    expect(credit).toBe('1234611.28');
  });

  it('records no GST when the amounts carry no tax', () => {
    const lines = buildBankEntry({
      direction: 'in',
      bankAccountId: BANK,
      gstAccountId: GST,
      amountsAre: 'no_tax',
      items: [{ accountId: SALES, amount: '50', taxCodeId: 'gst10' }],
      taxRates: rates,
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ credit: '50.00', taxAmount: '0.00' });
  });

  it('refuses a line to the same bank account, a missing amount or an unknown tax code', () => {
    const base = {
      direction: 'in' as const,
      bankAccountId: BANK,
      gstAccountId: GST,
      amountsAre: 'inclusive' as const,
      taxRates: rates,
    };
    expect(() =>
      buildBankEntry({ ...base, items: [{ accountId: BANK, amount: '1', taxCodeId: null }] }),
    ).toThrow(PostingError);
    expect(() =>
      buildBankEntry({ ...base, items: [{ accountId: SALES, amount: '0', taxCodeId: null }] }),
    ).toThrow(PostingError);
    expect(() =>
      buildBankEntry({ ...base, items: [{ accountId: SALES, amount: '1', taxCodeId: 'nope' }] }),
    ).toThrow(PostingError);
    expect(() => buildBankEntry({ ...base, items: [] })).toThrow(PostingError);
  });
});

describe('transfers and journals', () => {
  it('moves money between two accounts', () => {
    expect(buildTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: '25' })).toEqual([
      expect.objectContaining({ accountId: 'b', debit: '25.00' }),
      expect.objectContaining({ accountId: 'a', credit: '25.00' }),
    ]);
    expect(() => buildTransfer({ fromAccountId: 'a', toAccountId: 'a', amount: '1' })).toThrow(
      PostingError,
    );
  });

  it('accepts a balanced journal and refuses one that does not balance', () => {
    expect(
      buildJournal({
        lines: [
          { accountId: 'a', debit: '10.00' },
          { accountId: 'b', credit: '10' },
        ],
      }),
    ).toHaveLength(2);
    expect(() =>
      buildJournal({
        lines: [
          { accountId: 'a', debit: '10.00' },
          { accountId: 'b', credit: '9.99' },
        ],
      }),
    ).toThrow('Debits (10.00) and credits (9.99) must be equal.');
  });

  it('refuses a line with both sides or neither', () => {
    expect(() =>
      buildJournal({
        lines: [
          { accountId: 'a', debit: '1', credit: '1' },
          { accountId: 'b', credit: '1' },
        ],
      }),
    ).toThrow(PostingError);
    expect(() =>
      buildJournal({
        lines: [{ accountId: 'a' }, { accountId: 'b', credit: '1' }],
      }),
    ).toThrow(PostingError);
  });

  it('balances opening balances against the opening balances account', () => {
    const lines = buildJournal({
      lines: [
        { accountId: 'bank', debit: '5000' },
        { accountId: 'loan', credit: '2000' },
      ],
      balancingAccountId: 'opening',
    });
    expect(lines.at(-1)).toMatchObject({ accountId: 'opening', credit: '3000.00' });
    expect(totals(lines)).toEqual({ debit: '5000.00', credit: '5000.00' });
  });
});

describe('the Australian pack', () => {
  const pack = COUNTRY_PACKS.AU!;

  it('has every account and tax code posting relies on, once', () => {
    for (const key of SYSTEM_ACCOUNT_KEYS) {
      expect(pack.accounts.filter((account) => account.systemKey === key)).toHaveLength(1);
    }
    for (const key of SYSTEM_TAX_KEYS) {
      expect(pack.taxCodes.filter((code) => code.systemKey === key)).toHaveLength(1);
    }
  });

  it('uses unique codes and only tax codes it defines', () => {
    const codes = pack.accounts.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
    const taxCodes = new Set(pack.taxCodes.map((code) => code.code));
    expect(taxCodes.size).toBe(pack.taxCodes.length);
    for (const account of pack.accounts) expect(taxCodes.has(account.tax)).toBe(true);
  });

  it('starts the financial year in July with 10% GST', () => {
    expect(pack.financialYearStartMonth).toBe(7);
    expect(pack.taxCodes.find((code) => code.systemKey === 'gst_on_income')?.rate).toBe('10.00');
  });
});
