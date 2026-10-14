'use server';

import { authedAction } from '@/server/action';

import { raiseConcernSchema, replyConcernSchema, setConcernStatusSchema } from './schemas';
import * as concernService from './service';

const PATHS = ['/concerns'];

export const raiseConcernAction = authedAction(
  { permission: 'concerns.raise', input: raiseConcernSchema, revalidate: PATHS },
  (ctx, input) => concernService.raiseConcern(ctx, input),
);
export const replyToConcernAction = authedAction(
  { permission: 'concerns.raise', input: replyConcernSchema, revalidate: PATHS },
  (ctx, input) => concernService.replyToConcern(ctx, input),
);
// Managers and the admin; the service checks which concerns each may answer.
export const setConcernStatusAction = authedAction(
  { permission: null, input: setConcernStatusSchema, revalidate: PATHS },
  (ctx, input) => concernService.setConcernStatus(ctx, input),
);
