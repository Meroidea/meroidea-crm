'use server';

import { z } from 'zod';

import { authedAction } from '@/server/action';

import {
  createOrganizationSchema,
  organizationIdSchema,
  updateOrganizationSchema,
} from './schemas';
import { searchOrganizationOptions } from './queries';
import * as organizationsService from './service';

export const createOrganizationAction = authedAction(
  {
    permission: 'organizations.manage',
    input: createOrganizationSchema,
    revalidate: ['/organizations'],
  },
  (ctx, input) => organizationsService.createOrganization(ctx, input),
);

export const updateOrganizationAction = authedAction(
  {
    permission: 'organizations.manage',
    input: updateOrganizationSchema,
    revalidate: ['/organizations', '/contacts'],
  },
  (ctx, input) => organizationsService.updateOrganization(ctx, input),
);

export const deleteOrganizationAction = authedAction(
  {
    permission: 'organizations.manage',
    input: organizationIdSchema,
    revalidate: ['/organizations', '/contacts'],
  },
  (ctx, input) => organizationsService.deleteOrganization(ctx, input.id),
);

/** A picker's search: organizations matching what was typed, or the ones named. */
export const searchOrganizationOptionsAction = authedAction(
  {
    permission: 'organizations.view',
    input: z.object({
      q: z.string().trim().max(100).default(''),
      ids: z.array(z.uuid()).max(20).optional(),
    }),
  },
  (ctx, input) => searchOrganizationOptions(ctx, input),
);
