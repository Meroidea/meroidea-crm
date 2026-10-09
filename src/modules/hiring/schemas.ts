import { z } from 'zod';

import { EMPLOYMENT_TYPES } from './compliance';
import {
  isValidBankAccount,
  isValidBsb,
  isValidTaxFileNumber,
  normalizeDigits,
} from './identifiers';

const isoDate = z.iso.date('Use a valid date');
const money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use an amount like 32.50');
const text = (max: number, message = 'This is required') =>
  z.string().trim().min(1, message).max(max);
/** Optional text that survives being validated twice: once by the form, again by the action. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalWith = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(''), z.null(), schema])
    .optional()
    .transform((value) => (value === '' || value == null ? null : (value as z.output<T>)));

export const createHireSchema = z.object({
  firstName: text(80, 'Enter their first name'),
  lastName: text(80, 'Enter their last name'),
  email: z.email('Enter a valid email address').max(200),
  phone: optionalText(40),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  positionTitle: text(120, 'Enter the position'),
  startDate: isoDate,
  endDate: optionalWith(isoDate),
  hoursPerWeek: optionalWith(
    z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Use hours like 38 or 22.5'),
  ),
  payBasis: z.enum(['hourly', 'annual']),
  payRate: money,
  awardCode: optionalText(20),
  awardName: optionalText(200),
  classification: optionalText(200),
  classificationRef: optionalText(40),
  /** Hourly minimum typed by the admin; ignored when the pay database supplies one. */
  minimumRate: optionalWith(money),
  belowMinimumReason: optionalText(300),
  contractorAbn: optionalText(20),
  probationMonths: optionalWith(z.coerce.number().int().min(1).max(12)),
});

export const contractIdSchema = z.object({ id: z.uuid() });
export const employeeIdSchema = z.object({ id: z.uuid() });

export const awardSearchSchema = z.object({ name: z.string().trim().min(3).max(80) });
export const classificationListSchema = z.object({ awardCode: z.string().trim().min(3).max(20) });
export const minimumRateSchema = z.object({
  awardCode: z.string().trim().min(3).max(20),
  classificationRef: z.string().trim().min(1).max(40),
});

const token = z.string().regex(/^[A-Za-z0-9_-]{40,50}$/);

export const acceptOfferSchema = z.object({
  token,
  fullName: text(170, 'Type your full name to accept'),
  readContract: z.literal(true, 'Confirm you have read the contract'),
  readStatements: z.literal(true, 'Confirm you have received the statements'),
});

export const declineOfferSchema = z.object({ token });

/** A yes/no select from the form, or the boolean it becomes when validated a second time. */
const yesNo = z
  .union([z.boolean(), z.enum(['yes', 'no'])])
  .transform((value) => value === true || value === 'yes');

export const payrollDetailsSchema = z.object({
  token,
  /** Blank is allowed: someone may not have a tax file number yet. */
  taxFileNumber: z
    .string()
    .trim()
    .transform(normalizeDigits)
    .refine(
      (value) => value === '' || isValidTaxFileNumber(value),
      'That is not a valid tax file number',
    ),
  taxResident: yesNo,
  claimsTaxFreeThreshold: yesNo,
  hasStudyLoan: yesNo,
  bankAccountName: text(120, 'Enter the name on the account'),
  bankBsb: z.string().trim().transform(normalizeDigits).refine(isValidBsb, 'A BSB has six digits'),
  bankAccount: z
    .string()
    .trim()
    .transform(normalizeDigits)
    .refine(isValidBankAccount, 'Enter the account number, digits only'),
  superFundName: text(160, 'Enter your super fund, or your employer’s default'),
  superFundUsi: optionalText(40),
  superMemberNumber: optionalText(40),
});

export type HireFormValues = z.input<typeof createHireSchema>;
export type CreateHireInput = z.output<typeof createHireSchema>;
export type AcceptOfferInput = z.output<typeof acceptOfferSchema>;
export type PayrollFormValues = z.input<typeof payrollDetailsSchema>;
export type PayrollDetailsInput = z.output<typeof payrollDetailsSchema>;
