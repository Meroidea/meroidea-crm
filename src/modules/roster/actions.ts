'use server';

import { authedAction } from '@/server/action';

import {
  addHolidaySchema,
  copyShiftSchema,
  createRosterSchema,
  holidayIdSchema,
  publishRosterSchema,
  rosterIdSchema,
  saveRulesSchema,
  saveShiftSchema,
  saveTeamSchema,
  shiftIdSchema,
  teamIdSchema,
} from './schemas';
import * as rosterService from './service';

const PATHS = ['/roster'];

export const createRosterAction = authedAction(
  { permission: 'rosters.manage', input: createRosterSchema, revalidate: PATHS },
  (ctx, input) => rosterService.createRoster(ctx, input),
);

export const publishRosterAction = authedAction(
  { permission: 'rosters.manage', input: publishRosterSchema, revalidate: PATHS },
  (ctx, input) => rosterService.publishRoster(ctx, input),
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

export const copyShiftAction = authedAction(
  { permission: 'rosters.manage', input: copyShiftSchema, revalidate: PATHS },
  (ctx, input) => rosterService.copyShift(ctx, input),
);

export const saveTeamAction = authedAction(
  { permission: 'rosters.manage', input: saveTeamSchema, revalidate: PATHS },
  (ctx, input) => rosterService.saveTeam(ctx, input),
);

export const deleteTeamAction = authedAction(
  { permission: 'rosters.manage', input: teamIdSchema, revalidate: PATHS },
  (ctx, input) => rosterService.deleteTeam(ctx, input.id),
);

export const saveRulesAction = authedAction(
  { permission: 'rosters.manage', input: saveRulesSchema, revalidate: PATHS },
  (ctx, input) => rosterService.saveRules(ctx, input),
);

export const addHolidayAction = authedAction(
  { permission: 'rosters.manage', input: addHolidaySchema, revalidate: PATHS },
  (ctx, input) => rosterService.addHoliday(ctx, input),
);

export const removeHolidayAction = authedAction(
  { permission: 'rosters.manage', input: holidayIdSchema, revalidate: PATHS },
  (ctx, input) => rosterService.removeHoliday(ctx, input.id),
);
