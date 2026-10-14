'use server';

import { authedAction } from '@/server/action';

import {
  approvalIdSchema,
  checklistSchema,
  createOpportunitySchema,
  decideApprovalSchema,
  moveStageSchema,
  opportunityContactSchema,
  opportunityIdSchema,
  removeOpportunityContactSchema,
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

export const setChecklistItemAction = authedAction(
  { permission: 'opportunities.edit', input: checklistSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.setChecklistItem(ctx, input),
);

export const addOpportunityContactAction = authedAction(
  { permission: 'opportunities.edit', input: opportunityContactSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.addOpportunityContact(ctx, input),
);

export const removeOpportunityContactAction = authedAction(
  { permission: 'opportunities.edit', input: removeOpportunityContactSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.removeOpportunityContact(ctx, input),
);

export const decideApprovalAction = authedAction(
  { permission: 'opportunities.approve', input: decideApprovalSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.decideApproval(ctx, input),
);

export const withdrawApprovalAction = authedAction(
  { permission: 'opportunities.edit', input: approvalIdSchema, revalidate: PATHS },
  (ctx, input) => opportunitiesService.withdrawApproval(ctx, input.approvalId),
);
