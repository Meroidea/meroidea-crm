'use server';

import { authedAction } from '@/server/action';

import {
  clockInSchema,
  clockOutSchema,
  decideEntriesSchema,
  entryIdSchema,
  manualEntrySchema,
} from './schemas';
import * as timesheetService from './service';

const PATHS = ['/timesheets'];
const clock = { permission: 'timesheets.clock', revalidate: PATHS } as const;

export const clockInAction = authedAction({ ...clock, input: clockInSchema }, (ctx, input) =>
  timesheetService.clockIn(ctx, input.note, input.position),
);
export const clockOutAction = authedAction({ ...clock, input: clockOutSchema }, (ctx, input) =>
  timesheetService.clockOut(ctx, input.breakMinutes, input.position),
);
export const saveManualEntryAction = authedAction(
  { ...clock, input: manualEntrySchema },
  (ctx, input) => timesheetService.saveManualEntry(ctx, input),
);
export const deleteEntryAction = authedAction({ ...clock, input: entryIdSchema }, (ctx, input) =>
  timesheetService.deleteEntry(ctx, input.id),
);
export const decideEntriesAction = authedAction(
  { permission: 'timesheets.manage', input: decideEntriesSchema, revalidate: PATHS },
  (ctx, input) => timesheetService.decideEntries(ctx, input),
);
