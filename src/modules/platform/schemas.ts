import { z } from 'zod';

import { BUSINESS_TYPES, FEATURE_KEYS } from '@/lib/features';

const features = z
  .array(z.enum(FEATURE_KEYS))
  .default([])
  .transform((keys) => [...new Set(keys)]);

export const createBusinessSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the business name').max(120),
  businessType: z.enum(BUSINESS_TYPES.map((type) => type.key)),
  adminName: z.string().trim().min(2, 'Enter the admin’s name').max(120),
  adminEmail: z.email('Enter a valid email address').max(200),
  features,
});

export const setFeaturesSchema = z.object({ tenantId: z.uuid(), features });
export const setStatusSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(['active', 'suspended']),
});
export const tenantIdSchema = z.object({ tenantId: z.uuid() });

const coordinate = (limit: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d{1,6})?$/, `Enter the ${label} as a decimal number, such as -33.868820`)
    .refine((value) => Math.abs(Number(value)) <= limit, `The ${label} is out of range`);

/** Where a business is, for location-locked clocking. Both blank clears it. */
export const setLocationSchema = z
  .object({
    tenantId: z.uuid(),
    latitude: z.union([coordinate(90, 'latitude'), z.literal('')]),
    longitude: z.union([coordinate(180, 'longitude'), z.literal('')]),
    radiusMetres: z.coerce
      .number('Enter the radius in metres')
      .int('Use whole metres')
      .min(5, 'At least 5 metres')
      .max(1000, 'At most 1000 metres'),
  })
  .refine((value) => (value.latitude === '') === (value.longitude === ''), {
    path: ['longitude'],
    message: 'Enter both the latitude and the longitude, or leave both empty',
  });
export type SetLocationInput = z.output<typeof setLocationSchema>;

export type CreateBusinessInput = z.output<typeof createBusinessSchema>;
