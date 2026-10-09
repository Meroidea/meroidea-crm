'use server';

import { authedAction } from '@/server/action';

import {
  addStageSchema,
  memberRoleSchema,
  moveStagePositionSchema,
  nameSchema,
  toggleSchema,
  updateStageSchema,
  workspaceSchema,
} from './schemas';
import * as settingsService from './service';
import { updateWorkspace } from './workspace';

const PATHS = ['/settings', '/pipeline', '/opportunities', '/dashboard'];

export const updateWorkspaceAction = authedAction(
  { permission: 'settings.manage', input: workspaceSchema, revalidate: ['/'] },
  (ctx, input) => updateWorkspace(ctx, input),
);
export const updateStageAction = authedAction(
  { permission: 'settings.manage', input: updateStageSchema, revalidate: PATHS },
  (ctx, input) => settingsService.updateStage(ctx, input),
);
export const addStageAction = authedAction(
  { permission: 'settings.manage', input: addStageSchema, revalidate: PATHS },
  (ctx, input) => settingsService.addStage(ctx, input.name),
);
export const moveStagePositionAction = authedAction(
  { permission: 'settings.manage', input: moveStagePositionSchema, revalidate: PATHS },
  (ctx, input) => settingsService.moveStagePosition(ctx, input),
);
export const toggleStageAction = authedAction(
  { permission: 'settings.manage', input: toggleSchema, revalidate: PATHS },
  (ctx, input) => settingsService.toggleStage(ctx, input),
);
export const addLeadSourceAction = authedAction(
  { permission: 'settings.manage', input: nameSchema, revalidate: ['/settings', '/contacts'] },
  (ctx, input) => settingsService.addLeadSource(ctx, input.name),
);
export const toggleLeadSourceAction = authedAction(
  { permission: 'settings.manage', input: toggleSchema, revalidate: ['/settings', '/contacts'] },
  (ctx, input) => settingsService.toggleLeadSource(ctx, input),
);
export const addLostReasonAction = authedAction(
  { permission: 'settings.manage', input: nameSchema, revalidate: ['/settings'] },
  (ctx, input) => settingsService.addLostReason(ctx, input.name),
);
export const toggleLostReasonAction = authedAction(
  { permission: 'settings.manage', input: toggleSchema, revalidate: ['/settings'] },
  (ctx, input) => settingsService.toggleLostReason(ctx, input),
);
export const changeMemberRoleAction = authedAction(
  { permission: 'users.manage', input: memberRoleSchema, revalidate: ['/settings'] },
  (ctx, input) => settingsService.changeMemberRole(ctx, input),
);
