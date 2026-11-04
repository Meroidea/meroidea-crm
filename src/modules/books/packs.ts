/**
 * Country packs: the chart of accounts and tax codes a business starts with. After setup they
 * are the business's own to rename, extend and archive; only `systemKey` rows stay, because
 * posting from invoices and payroll looks them up. Australia is the first pack (ADR-060). A new
 * country is a new entry here, not a code change elsewhere.
 *
 * This is a simple small-business starting chart. It should be reviewed by a qualified
 * accountant in each country before businesses rely on it.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type AccountSubtype =
  | 'bank'
  | 'current_asset'
  | 'fixed_asset'
  | 'non_current_asset'
  | 'current_liability'
  | 'non_current_liability'
  | 'equity'
  | 'revenue'
  | 'other_income'
  | 'cost_of_sales'
  | 'expense'
  | 'other_expense';
export type TaxKind =
  'taxable' | 'gst_free' | 'input_taxed' | 'export' | 'capital' | 'out_of_scope';
export type TaxAppliesTo = 'sales' | 'purchases' | 'both';

/** Accounts that posting relies on. Each pack must name every one of these. */
export const SYSTEM_ACCOUNT_KEYS = [
  'bank',
  'accounts_receivable',
  'accounts_payable',
  'gst',
  'wages_payable',
  'payg_withholding',
  'super_payable',
  'suspense',
  'retained_earnings',
  'opening_balances',
  'sales',
  'wages_expense',
  'super_expense',
] as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

export const SYSTEM_TAX_KEYS = [
  'gst_on_income',
  'gst_free_income',
  'gst_on_expenses',
  'gst_free_expenses',
  'bas_excluded',
] as const;
export type SystemTaxKey = (typeof SYSTEM_TAX_KEYS)[number];

export type PackTaxCode = {
  code: string;
  name: string;
  rate: string;
  kind: TaxKind;
  appliesTo: TaxAppliesTo;
  systemKey?: SystemTaxKey;
};

export type PackAccount = {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  isBank?: boolean;
  systemKey?: SystemAccountKey;
  /** The tax code this account usually takes, by the tax code's `code`. */
  tax: string;
};

export type CountryPack = {
  country: string;
  label: string;
  currency: string;
  financialYearStartMonth: number;
  taxName: string;
  taxCodes: PackTaxCode[];
  accounts: PackAccount[];
};

const AU: CountryPack = {
  country: 'AU',
  label: 'Australia',
  currency: 'AUD',
  financialYearStartMonth: 7,
  taxName: 'GST',
  taxCodes: [
    {
      code: 'GST',
      name: 'GST on Income',
      rate: '10.00',
      kind: 'taxable',
      appliesTo: 'sales',
      systemKey: 'gst_on_income',
    },
    {
      code: 'GST-P',
      name: 'GST on Expenses',
      rate: '10.00',
      kind: 'taxable',
      appliesTo: 'purchases',
      systemKey: 'gst_on_expenses',
    },
    {
      code: 'FRE',
      name: 'GST Free Income',
      rate: '0.00',
      kind: 'gst_free',
      appliesTo: 'sales',
      systemKey: 'gst_free_income',
    },
    {
      code: 'FRE-P',
      name: 'GST Free Expenses',
      rate: '0.00',
      kind: 'gst_free',
      appliesTo: 'purchases',
      systemKey: 'gst_free_expenses',
    },
    { code: 'CAP', name: 'GST on Capital', rate: '10.00', kind: 'capital', appliesTo: 'purchases' },
    { code: 'EXP', name: 'GST Free Exports', rate: '0.00', kind: 'export', appliesTo: 'sales' },
    { code: 'INP', name: 'Input Taxed', rate: '0.00', kind: 'input_taxed', appliesTo: 'both' },
    {
      code: 'BASX',
      name: 'BAS Excluded',
      rate: '0.00',
      kind: 'out_of_scope',
      appliesTo: 'both',
      systemKey: 'bas_excluded',
    },
  ],
  accounts: [
    // Assets
    {
      code: '090',
      name: 'Business bank account',
      type: 'asset',
      subtype: 'bank',
      isBank: true,
      systemKey: 'bank',
      tax: 'BASX',
    },
    {
      code: '091',
      name: 'Business savings account',
      type: 'asset',
      subtype: 'bank',
      isBank: true,
      tax: 'BASX',
    },
    {
      code: '095',
      name: 'Cash on hand',
      type: 'asset',
      subtype: 'bank',
      isBank: true,
      tax: 'BASX',
    },
    {
      code: '610',
      name: 'Accounts receivable',
      type: 'asset',
      subtype: 'current_asset',
      systemKey: 'accounts_receivable',
      tax: 'BASX',
    },
    { code: '620', name: 'Prepayments', type: 'asset', subtype: 'current_asset', tax: 'BASX' },
    { code: '630', name: 'Inventory', type: 'asset', subtype: 'current_asset', tax: 'BASX' },
    { code: '710', name: 'Office equipment', type: 'asset', subtype: 'fixed_asset', tax: 'CAP' },
    { code: '720', name: 'Computer equipment', type: 'asset', subtype: 'fixed_asset', tax: 'CAP' },
    { code: '730', name: 'Motor vehicles', type: 'asset', subtype: 'fixed_asset', tax: 'CAP' },
    // Liabilities
    {
      code: '800',
      name: 'Accounts payable',
      type: 'liability',
      subtype: 'current_liability',
      systemKey: 'accounts_payable',
      tax: 'BASX',
    },
    {
      code: '803',
      name: 'Wages payable',
      type: 'liability',
      subtype: 'current_liability',
      systemKey: 'wages_payable',
      tax: 'BASX',
    },
    {
      code: '810',
      name: 'Business credit card',
      type: 'liability',
      subtype: 'current_liability',
      isBank: true,
      tax: 'BASX',
    },
    {
      code: '820',
      name: 'GST',
      type: 'liability',
      subtype: 'current_liability',
      systemKey: 'gst',
      tax: 'BASX',
    },
    {
      code: '825',
      name: 'PAYG withholding payable',
      type: 'liability',
      subtype: 'current_liability',
      systemKey: 'payg_withholding',
      tax: 'BASX',
    },
    {
      code: '826',
      name: 'Superannuation payable',
      type: 'liability',
      subtype: 'current_liability',
      systemKey: 'super_payable',
      tax: 'BASX',
    },
    {
      code: '830',
      name: 'Income tax payable',
      type: 'liability',
      subtype: 'current_liability',
      tax: 'BASX',
    },
    {
      code: '850',
      name: 'Suspense',
      type: 'liability',
      subtype: 'current_liability',
      systemKey: 'suspense',
      tax: 'BASX',
    },
    { code: '900', name: 'Loan', type: 'liability', subtype: 'non_current_liability', tax: 'BASX' },
    // Equity
    {
      code: '960',
      name: 'Retained earnings',
      type: 'equity',
      subtype: 'equity',
      systemKey: 'retained_earnings',
      tax: 'BASX',
    },
    { code: '970', name: 'Owner funds introduced', type: 'equity', subtype: 'equity', tax: 'BASX' },
    { code: '980', name: 'Owner drawings', type: 'equity', subtype: 'equity', tax: 'BASX' },
    {
      code: '990',
      name: 'Opening balances',
      type: 'equity',
      subtype: 'equity',
      systemKey: 'opening_balances',
      tax: 'BASX',
    },
    // Income
    {
      code: '200',
      name: 'Sales',
      type: 'income',
      subtype: 'revenue',
      systemKey: 'sales',
      tax: 'GST',
    },
    { code: '260', name: 'Other revenue', type: 'income', subtype: 'revenue', tax: 'GST' },
    { code: '270', name: 'Interest income', type: 'income', subtype: 'other_income', tax: 'INP' },
    // Cost of sales
    {
      code: '310',
      name: 'Cost of goods sold',
      type: 'expense',
      subtype: 'cost_of_sales',
      tax: 'GST-P',
    },
    // Expenses
    { code: '400', name: 'Advertising', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    { code: '404', name: 'Bank fees', type: 'expense', subtype: 'expense', tax: 'FRE-P' },
    { code: '408', name: 'Cleaning', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    {
      code: '412',
      name: 'Consulting and accounting',
      type: 'expense',
      subtype: 'expense',
      tax: 'GST-P',
    },
    { code: '420', name: 'Entertainment', type: 'expense', subtype: 'expense', tax: 'BASX' },
    { code: '425', name: 'Freight and courier', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    { code: '429', name: 'General expenses', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    { code: '433', name: 'Insurance', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    { code: '441', name: 'Legal expenses', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    {
      code: '445',
      name: 'Light, power and heating',
      type: 'expense',
      subtype: 'expense',
      tax: 'GST-P',
    },
    {
      code: '449',
      name: 'Motor vehicle expenses',
      type: 'expense',
      subtype: 'expense',
      tax: 'GST-P',
    },
    { code: '453', name: 'Office expenses', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    {
      code: '461',
      name: 'Printing and stationery',
      type: 'expense',
      subtype: 'expense',
      tax: 'GST-P',
    },
    { code: '469', name: 'Rent', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    {
      code: '473',
      name: 'Repairs and maintenance',
      type: 'expense',
      subtype: 'expense',
      tax: 'GST-P',
    },
    {
      code: '477',
      name: 'Wages and salaries',
      type: 'expense',
      subtype: 'expense',
      systemKey: 'wages_expense',
      tax: 'BASX',
    },
    {
      code: '478',
      name: 'Superannuation',
      type: 'expense',
      subtype: 'expense',
      systemKey: 'super_expense',
      tax: 'BASX',
    },
    { code: '485', name: 'Subscriptions', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    {
      code: '489',
      name: 'Telephone and internet',
      type: 'expense',
      subtype: 'expense',
      tax: 'GST-P',
    },
    { code: '493', name: 'Travel', type: 'expense', subtype: 'expense', tax: 'GST-P' },
    {
      code: '437',
      name: 'Interest expense',
      type: 'expense',
      subtype: 'other_expense',
      tax: 'INP',
    },
  ],
};

export const COUNTRY_PACKS: Record<string, CountryPack> = { AU };

export function countryPack(country: string | null | undefined): CountryPack | null {
  return COUNTRY_PACKS[(country ?? '').toUpperCase()] ?? null;
}

export const ACCOUNT_TYPES: { type: AccountType; label: string; subtypes: AccountSubtype[] }[] = [
  {
    type: 'asset',
    label: 'Asset',
    subtypes: ['bank', 'current_asset', 'fixed_asset', 'non_current_asset'],
  },
  {
    type: 'liability',
    label: 'Liability',
    subtypes: ['current_liability', 'non_current_liability'],
  },
  { type: 'equity', label: 'Equity', subtypes: ['equity'] },
  { type: 'income', label: 'Income', subtypes: ['revenue', 'other_income'] },
  { type: 'expense', label: 'Expense', subtypes: ['cost_of_sales', 'expense', 'other_expense'] },
];

export const SUBTYPE_LABELS: Record<AccountSubtype, string> = {
  bank: 'Bank and cash',
  current_asset: 'Current assets',
  fixed_asset: 'Fixed assets',
  non_current_asset: 'Non-current assets',
  current_liability: 'Current liabilities',
  non_current_liability: 'Non-current liabilities',
  equity: 'Equity',
  revenue: 'Trading income',
  other_income: 'Other income',
  cost_of_sales: 'Cost of sales',
  expense: 'Operating expenses',
  other_expense: 'Other expenses',
};

export const TAX_KIND_LABELS: Record<TaxKind, string> = {
  taxable: 'Taxable',
  gst_free: 'Tax free',
  input_taxed: 'Input taxed',
  export: 'Export',
  capital: 'Capital purchase',
  out_of_scope: 'Not reported',
};
