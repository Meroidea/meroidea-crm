'use server';

import { authedAction } from '@/server/action';

import { authoriseRosterSchema, rosterIdSchema, setTaxWithheldSchema } from './schemas';
import * as payrollService from './service';

const PATHS = ['/payroll', '/payslips', '/roster'];
const manage = { permission: 'payroll.manage', revalidate: PATHS } as const;

export const authoriseRosterAction = authedAction(
  { ...manage, input: authoriseRosterSchema },
  (ctx, input) => payrollService.authoriseRoster(ctx, input),
);
export const setTaxWithheldAction = authedAction(
  { ...manage, input: setTaxWithheldSchema },
  (ctx, input) => payrollService.setTaxWithheld(ctx, input),
);
export const releasePayslipsAction = authedAction(
  { ...manage, input: rosterIdSchema },
  (ctx, input) => payrollService.releasePayslips(ctx, input.rosterId),
);
