'use server';

import { authedAction } from '@/server/action';
import { getMinimumRate, listClassifications, searchAwards } from '@/server/fair-work';

import {
  awardSearchSchema,
  classificationListSchema,
  contractIdSchema,
  createHireSchema,
  employeeIdSchema,
  minimumRateSchema,
} from './schemas';
import * as hiringService from './service';

const PATHS = ['/hiring'];

export const createHireAction = authedAction(
  { permission: 'employees.manage', input: createHireSchema, revalidate: PATHS },
  (ctx, input) => hiringService.createHire(ctx, input),
);

export const sendContractAction = authedAction(
  { permission: 'employees.manage', input: contractIdSchema, revalidate: PATHS },
  (ctx, input) => hiringService.sendContract(ctx, input.id),
);

export const withdrawContractAction = authedAction(
  { permission: 'employees.manage', input: contractIdSchema, revalidate: PATHS },
  (ctx, input) => hiringService.withdrawContract(ctx, input.id),
);

export const revealPayrollDetailsAction = authedAction(
  { permission: 'employees.view_sensitive', input: employeeIdSchema },
  (ctx, input) => hiringService.revealPayrollDetails(ctx, input.id),
);

// Lookups against the Fair Work pay database. Read-only, but still behind the hiring permission
// so the workspace's key is not an open proxy for anyone signed in.
export const searchAwardsAction = authedAction(
  { permission: 'employees.manage', input: awardSearchSchema },
  (_ctx, input) => searchAwards(input.name),
);

export const listClassificationsAction = authedAction(
  { permission: 'employees.manage', input: classificationListSchema },
  (_ctx, input) => listClassifications(input.awardCode),
);

export const getMinimumRateAction = authedAction(
  { permission: 'employees.manage', input: minimumRateSchema },
  (_ctx, input) => getMinimumRate(input.awardCode, input.classificationRef),
);
