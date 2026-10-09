'use server';

import { authedAction } from '@/server/action';

import { createRosterSchema, rosterIdSchema, saveShiftSchema, shiftIdSchema } from './schemas';
import * as rosterService from './service';

const PATHS = ['/roster'];

export const createRosterAction = authedAction(
  { permission: 'rosters.manage', input: createRosterSchema, revalidate: PATHS },
  (ctx, input) => rosterService.createRoster(ctx, input),
);

export const publishRosterAction = authedAction(
  { permission: 'rosters.manage', input: rosterIdSchema, revalidate: PATHS },
  (ctx, input) => rosterService.publishRoster(ctx, input.id),
);

export const unpublishRosterAction = authedAction(
  { permission: 'rosters.manage', input: rosterIdSchema, revalidate: PATHS },
  (ctx, input) => rosterService.unpublishRoster(ctx, input.id),
);

export const deleteRosterAction = authedAction(
  { permission: 'rosters.manage', input: rosterIdSchema, revalidate: PATHS },
  (ctx, input) => rosterService.deleteRoster(ctx, input.id),
);

export const saveShiftAction = authedAction(
  { permission: 'rosters.manage', input: saveShiftSchema, revalidate: PATHS },
  (ctx, input) => rosterService.saveShift(ctx, input),
);

export const deleteShiftAction = authedAction(
  { permission: 'rosters.manage', input: shiftIdSchema, revalidate: PATHS },
  (ctx, input) => rosterService.deleteShift(ctx, input.id),
);
