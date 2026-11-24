'use server';

import { authedAction } from '@/server/action';

import { saveTradingHoursSchema } from './schemas';
import * as tradingHoursService from './service';

export const saveTradingHoursAction = authedAction(
  {
    permission: 'settings.manage',
    input: saveTradingHoursSchema,
    revalidate: ['/settings', '/roster'],
  },
  (ctx, input) => tradingHoursService.saveTradingHours(ctx, input),
);
