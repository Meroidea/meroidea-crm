/**
 * Turns what someone records in plain words ("money in", "money out", "a transfer") into the
 * debit and credit lines of one balanced entry. Pure: the database checks the result again and
 * refuses anything that does not balance (ADR-060).
 */
import { formatCents, parseCents, rateBasisPoints, taxInInclusive, taxOnExclusive } from './money';

export type PostingLine = {
  accountId: string;
  debit: string;
  credit: string;
  description: string | null;
  taxCodeId: string | null;
  taxAmount: string | null;
};

export type AmountsAre = 'inclusive' | 'exclusive' | 'no_tax';

export type MoneyItem = {
  accountId: string;
  description?: string | null;
  amount: string;
  taxCodeId?: string | null;
};

export class PostingError extends Error {}

const line = (
  accountId: string,
  side: 'debit' | 'credit',
  cents: bigint,
  extra: Partial<Omit<PostingLine, 'accountId' | 'debit' | 'credit'>> = {},
): PostingLine => ({
  accountId,
  debit: side === 'debit' ? formatCents(cents) : '0.00',
  credit: side === 'credit' ? formatCents(cents) : '0.00',
  description: extra.description ?? null,
  taxCodeId: extra.taxCodeId ?? null,
  taxAmount: extra.taxAmount ?? null,
});

/**
 * Money in: the bank is debited with everything received, each item's account credited with its
 * amount before tax, and the GST collected credited to the GST account. Money out is the mirror.
 */
export type TaxedItem = {
  accountId: string;
  description: string | null;
  taxCodeId: string | null;
  /** Before tax, in cents. */
  net: bigint;
  tax: bigint;
};

/**
 * Each line's amount before tax and its GST, from what was typed: amounts including GST,
 * excluding it, or with none. Rounded per line, half up, the way GST is shown on a tax invoice.
 */
export function splitTax(
  items: MoneyItem[],
  amountsAre: AmountsAre,
  taxRates: ReadonlyMap<string, string>,
): TaxedItem[] {
  if (items.length === 0) throw new PostingError('Add at least one line.');
  return items.map((item) => {
    const amount = parseCents(item.amount);
    if (amount === null || amount <= 0n) throw new PostingError('Each line needs an amount.');
    const taxCodeId = item.taxCodeId || null;
    let points = 0n;
    if (taxCodeId && amountsAre !== 'no_tax') {
      const rate = taxRates.get(taxCodeId);
      const parsed = rate === undefined ? null : rateBasisPoints(rate);
      if (parsed === null) throw new PostingError('That tax code is not available.');
      points = parsed;
    }
    const tax =
      amountsAre === 'inclusive'
        ? taxInInclusive(amount, points)
        : amountsAre === 'exclusive'
          ? taxOnExclusive(amount, points)
          : 0n;
    const net = amountsAre === 'inclusive' ? amount - tax : amount;
    if (net <= 0n) throw new PostingError('Each line needs an amount after tax.');
    return {
      accountId: item.accountId,
      description: item.description?.trim() || null,
      taxCodeId,
      net,
      tax,
    };
  });
}

/**
 * Money in: the bank is debited with everything received, each item's account credited with its
 * amount before tax, and the GST collected credited to the GST account. Money out is the mirror.
 */
export function buildBankEntry(input: {
  direction: 'in' | 'out';
  bankAccountId: string;
  gstAccountId: string;
  amountsAre: AmountsAre;
  items: MoneyItem[];
  /** Tax code id → rate, such as "10.00". */
  taxRates: ReadonlyMap<string, string>;
}): PostingLine[] {
  if (input.items.some((item) => item.accountId === input.bankAccountId)) {
    throw new PostingError('A line cannot go to the same bank account the money moves through.');
  }
  const itemSide = input.direction === 'in' ? 'credit' : 'debit';
  const bankSide = input.direction === 'in' ? 'debit' : 'credit';
  const taxed = splitTax(input.items, input.amountsAre, input.taxRates);
  const lines: PostingLine[] = taxed.map((item) =>
    line(item.accountId, itemSide, item.net, {
      description: item.description,
      taxCodeId: item.taxCodeId,
      taxAmount: item.taxCodeId ? formatCents(item.tax) : null,
    }),
  );
  const totalTax = taxed.reduce((sum, item) => sum + item.tax, 0n);
  const totalGross = taxed.reduce((sum, item) => sum + item.net + item.tax, 0n);
  if (totalTax > 0n) {
    lines.push(
      line(input.gstAccountId, itemSide, totalTax, {
        description: input.direction === 'in' ? 'GST collected' : 'GST paid',
      }),
    );
  }
  lines.unshift(line(input.bankAccountId, bankSide, totalGross));
  return lines;
}

export type BillLine = {
  accountId: string;
  description: string | null;
  amount: string;
  taxCodeId: string | null;
  taxAmount: string;
};

/** A supplier bill's stored lines and totals, worked out exactly from what was typed. */
export function buildBill(input: {
  amountsAre: AmountsAre;
  items: MoneyItem[];
  taxRates: ReadonlyMap<string, string>;
}): { lines: BillLine[]; subtotal: string; taxTotal: string; total: string } {
  const taxed = splitTax(input.items, input.amountsAre, input.taxRates);
  const subtotal = taxed.reduce((sum, item) => sum + item.net, 0n);
  const taxTotal = taxed.reduce((sum, item) => sum + item.tax, 0n);
  return {
    lines: taxed.map((item) => ({
      accountId: item.accountId,
      description: item.description,
      amount: formatCents(item.net),
      taxCodeId: item.taxCodeId,
      taxAmount: formatCents(item.tax),
    })),
    subtotal: formatCents(subtotal),
    taxTotal: formatCents(taxTotal),
    total: formatCents(subtotal + taxTotal),
  };
}

/** Money moved between two of the business's own accounts: bank to bank, or to a credit card. */
export function buildTransfer(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
}): PostingLine[] {
  if (input.fromAccountId === input.toAccountId) {
    throw new PostingError('Choose two different accounts.');
  }
  const amount = parseCents(input.amount);
  if (amount === null || amount <= 0n) throw new PostingError('Enter the amount moved.');
  return [
    line(input.toAccountId, 'debit', amount, { description: 'Transfer in' }),
    line(input.fromAccountId, 'credit', amount, { description: 'Transfer out' }),
  ];
}

export type JournalInputLine = {
  accountId: string;
  description?: string | null;
  debit?: string | null;
  credit?: string | null;
};

/**
 * A journal as typed: every line on one side only, and debits equal to credits. For opening
 * balances, any difference goes to the opening balances account, the way most bookkeeping tools
 * take a starting position without making someone balance it by hand.
 */
export function buildJournal(input: {
  lines: JournalInputLine[];
  balancingAccountId?: string | null;
}): PostingLine[] {
  const lines: PostingLine[] = [];
  let debits = 0n;
  let credits = 0n;
  for (const entry of input.lines) {
    const debit = entry.debit?.trim() ? parseCents(entry.debit) : 0n;
    const credit = entry.credit?.trim() ? parseCents(entry.credit) : 0n;
    if (debit === null || credit === null)
      throw new PostingError('Amounts are in dollars and cents.');
    if (debit > 0n === credit > 0n) {
      throw new PostingError('Each line is either a debit or a credit.');
    }
    const description = entry.description?.trim() || null;
    lines.push(
      debit > 0n
        ? line(entry.accountId, 'debit', debit, { description })
        : line(entry.accountId, 'credit', credit, { description }),
    );
    debits += debit;
    credits += credit;
  }
  if (debits !== credits && input.balancingAccountId) {
    lines.push(
      debits > credits
        ? line(input.balancingAccountId, 'credit', debits - credits, {
            description: 'Opening balance',
          })
        : line(input.balancingAccountId, 'debit', credits - debits, {
            description: 'Opening balance',
          }),
    );
    debits = credits = debits > credits ? debits : credits;
  }
  if (lines.length < 2) throw new PostingError('A journal needs at least two lines.');
  if (debits !== credits) {
    throw new PostingError(
      `Debits (${formatCents(debits)}) and credits (${formatCents(credits)}) must be equal.`,
    );
  }
  return lines;
}

/** The shape the database posting function reads. */
export function toDatabaseLines(lines: PostingLine[]) {
  return lines.map((entry) => ({
    account_id: entry.accountId,
    debit: entry.debit,
    credit: entry.credit,
    description: entry.description,
    tax_code_id: entry.taxCodeId,
    tax_amount: entry.taxAmount,
  }));
}
