'use server';

import { z } from 'zod';

import { authedAction } from '@/server/action';

import { recordReportExport } from './service';

export const recordReportExportAction = authedAction(
  {
    permission: 'reports.export',
    input: z.object({ report: z.string().trim().min(1).max(80), rows: z.number().int().min(0) }),
  },
  (ctx, input) => recordReportExport(ctx, input),
);
