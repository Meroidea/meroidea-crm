'use server';

import { authedAction } from '@/server/action';

import {
  createOrganizationSchema,
  organizationIdSchema,
  updateOrganizationSchema,
} from './schemas';
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
