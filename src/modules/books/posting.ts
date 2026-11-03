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
export function buildBankEntry(input: {
  direction: 'in' | 'out';
  bankAccountId: string;
  gstAccountId: string;
  amountsAre: AmountsAre;
  items: MoneyItem[];
  /** Tax code id → rate, such as "10.00". */
  taxRates: ReadonlyMap<string, string>;
}): PostingLine[] {
  if (input.items.length === 0) throw new PostingError('Add at least one line.');
  const itemSide = input.direction === 'in' ? 'credit' : 'debit';
  const bankSide = input.direction === 'in' ? 'debit' : 'credit';
  const lines: PostingLine[] = [];
  let totalTax = 0n;
  let totalGross = 0n;

  for (const item of input.items) {
    if (item.accountId === input.bankAccountId) {
      throw new PostingError('A line cannot go to the same bank account the money moves through.');
    }
    const amount = parseCents(item.amount);
    if (amount === null || amount <= 0n) throw new PostingError('Each line needs an amount.');
    const taxCodeId = item.taxCodeId || null;
    let points = 0n;
    if (taxCodeId && input.amountsAre !== 'no_tax') {
      const rate = input.taxRates.get(taxCodeId);
      const parsed = rate === undefined ? null : rateBasisPoints(rate);
      if (parsed === null) throw new PostingError('That tax code is not available.');
      points = parsed;
    }
    const tax =
      input.amountsAre === 'inclusive'
        ? taxInInclusive(amount, points)
        : input.amountsAre === 'exclusive'
          ? taxOnExclusive(amount, points)
          : 0n;
    const net = input.amountsAre === 'inclusive' ? amount - tax : amount;
    if (net <= 0n) throw new PostingError('Each line needs an amount after tax.');
    lines.push(
      line(item.accountId, itemSide, net, {
        description: item.description?.trim() || null,
        taxCodeId,
        taxAmount: taxCodeId ? formatCents(tax) : null,
      }),
    );
    totalTax += tax;
    totalGross += net + tax;
  }

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
