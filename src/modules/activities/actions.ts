'use server';

import { authedAction } from '@/server/action';

import { logActivitySchema } from './schemas';
import * as activitiesService from './service';

export const logActivityAction = authedAction(
  {
    permission: 'activities.create',
    input: logActivitySchema,
    revalidate: ['/contacts', '/opportunities', '/pipeline', '/dashboard'],
  },
  (ctx, input) => activitiesService.logActivity(ctx, input),
);
