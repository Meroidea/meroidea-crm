'use server';

import { z } from 'zod';

import { authedAction } from '@/server/action';

import { markRead } from './service';

export const markNotificationReadAction = authedAction(
  {
    permission: null,
    input: z.object({ id: z.union([z.uuid(), z.literal('all')]) }),
    revalidate: ['/notifications'],
  },
  (ctx, input) => markRead(ctx, input.id),
);
