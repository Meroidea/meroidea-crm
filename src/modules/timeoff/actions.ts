'use server';

import { authedAction } from '@/server/action';

import { decideLeaveSchema, leaveIdSchema, leaveTypeSchema, requestLeaveSchema } from './schemas';
import * as timeOffService from './service';

const PATHS = ['/time-off'];

export const requestLeaveAction = authedAction(
  { permission: 'timeoff.request', input: requestLeaveSchema, revalidate: PATHS },
  (ctx, input) => timeOffService.requestLeave(ctx, input),
);
export const cancelLeaveAction = authedAction(
  { permission: 'timeoff.request', input: leaveIdSchema, revalidate: PATHS },
  (ctx, input) => timeOffService.cancelLeave(ctx, input.id),
);
export const decideLeaveAction = authedAction(
  { permission: 'timeoff.manage', input: decideLeaveSchema, revalidate: PATHS },
  (ctx, input) => timeOffService.decideLeave(ctx, input),
);
export const saveLeaveTypeAction = authedAction(
  { permission: 'timeoff.manage', input: leaveTypeSchema, revalidate: PATHS },
  (ctx, input) => timeOffService.saveLeaveType(ctx, input),
);
