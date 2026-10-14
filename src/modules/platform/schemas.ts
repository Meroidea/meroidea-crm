import { z } from 'zod';

import { BUSINESS_TYPES, FEATURE_KEYS } from '@/lib/features';
import { isValidAbn } from '@/modules/hiring/identifiers';

const features = z
  .array(z.enum(FEATURE_KEYS))
  .default([])
  .transform((keys) => [...new Set(keys)]);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/*
 * Who a business is (ADR-047). Recorded by the platform owner when onboarding it and changed only
 * from the platform console; the business's own admin sees these but cannot edit them.
 */
const identity = {
  companyName: z.string().trim().min(2, 'Enter the business name').max(120),
  /** The registered name, when it differs from the name the business trades under. */
  legalName: optionalText(120),
  /** Stored with single spaces in the usual 2-3-3-3 grouping so it prints the same everywhere. */
  businessNumber: z
    .string()
    .trim()
    .refine(isValidAbn, 'Enter a valid 11-digit ABN')
    .transform((value) => {
      const digits = value.replace(/[\s-]/g, '');
      return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    }),
  primaryContactName: z.string().trim().min(2, 'Enter the primary contact’s name').max(120),
  primaryContactEmail: z.email('Enter a valid email address').max(200),
  primaryContactPhone: z
    .string()
    .trim()
    .min(6, 'Enter the primary contact’s phone number')
    .max(40)
    .regex(/^[0-9+()\s-]+$/, 'Use digits, spaces, + ( ) and - only'),
};

export const businessIdentitySchema = z.object({ tenantId: z.uuid(), ...identity });
export type BusinessIdentityInput = z.output<typeof businessIdentitySchema>;

const coordinate = (limit: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d{1,6})?$/, `Enter the ${label} as a decimal number, such as -33.868820`)
    .refine((value) => Math.abs(Number(value)) <= limit, `The ${label} is out of range`);

const location = {
  latitude: z.union([coordinate(90, 'latitude'), z.literal('')]),
  longitude: z.union([coordinate(180, 'longitude'), z.literal('')]),
  radiusMetres: z.coerce
    .number('Enter the radius in metres')
    .int('Use whole metres')
    .min(5, 'At least 5 metres')
    .max(1000, 'At most 1000 metres'),
};

const bothOrNeither = {
  check: (value: { latitude: string; longitude: string }) =>
    (value.latitude === '') === (value.longitude === ''),
  issue: {
    path: ['longitude'],
    message: 'Enter both the latitude and the longitude, or leave both empty',
  },
};

export const createBusinessSchema = z
  .object({
    ...identity,
    businessType: z.enum(BUSINESS_TYPES.map((type) => type.key)),
    adminName: z.string().trim().min(2, 'Enter the admin’s name').max(120),
    adminEmail: z.email('Enter a valid email address').max(200),
    features,
    latitude: location.latitude.default(''),
    longitude: location.longitude.default(''),
    radiusMetres: location.radiusMetres.default(10),
  })
  .refine(bothOrNeither.check, bothOrNeither.issue);

export type CreateBusinessInput = z.output<typeof createBusinessSchema>;

export const setFeaturesSchema = z.object({ tenantId: z.uuid(), features });
export const setStatusSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(['active', 'suspended']),
});
export const tenantIdSchema = z.object({ tenantId: z.uuid() });

/** Where a business is, for location-locked clocking. Both blank clears it. */
export const setLocationSchema = z
  .object({ tenantId: z.uuid(), ...location })
  .refine(bothOrNeither.check, bothOrNeither.issue);
export type SetLocationInput = z.output<typeof setLocationSchema>;

/** A new version of the service agreement. Published versions are never edited. */
export const publishAgreementSchema = z.object({
  title: z.string().trim().min(3, 'Give the agreement a title').max(120),
  body: z
    .string()
    .trim()
    .min(200, 'The agreement looks too short. Paste its full wording.')
    .max(100_000, 'The agreement is too long'),
});
export type PublishAgreementInput = z.output<typeof publishAgreementSchema>;

/** What the business's admin types to accept the agreement on its one-time page. */
export const acceptAgreementSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/),
  fullName: z.string().trim().min(2, 'Type your full name').max(120),
  agree: z.literal(true, 'Tick the box to confirm you accept'),
});
export type AcceptAgreementInput = z.output<typeof acceptAgreementSchema>;
