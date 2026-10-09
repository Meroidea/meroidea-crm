'use server';

import { authedAction } from '@/server/action';

import {
  createOpportunitySchema,
  moveStageSchema,
  opportunityIdSchema,
  updateOpportunitySchema,
} from './schemas';
import * as opportunitiesService from './service';

const PATHS = ['/opportunities', '/pipeline', '/contacts', '/dashboard', '/reports'];

export const createOpportunityAction = authedAction(
  { permission: 'opportunities.create', input: createOpportunitySchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.createOpportunity(ctx, input),
);

export const updateOpportunityAction = authedAction(
  { permission: 'opportunities.edit', input: updateOpportunitySchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.updateOpportunity(ctx, input),
);

export const moveStageAction = authedAction(
  { permission: 'opportunities.edit', input: moveStageSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.moveStage(ctx, input),
);

export const deleteOpportunityAction = authedAction(
  { permission: 'opportunities.delete', input: opportunityIdSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.deleteOpportunity(ctx, input.id),
);
