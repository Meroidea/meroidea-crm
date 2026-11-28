'use server';

import { authedAction } from '@/server/action';

import {
  createSignRequestSchema,
  remindSignerSchema,
  requestIdSchema,
  saveDraftSchema,
  voidRequestSchema,
} from './schemas';
import * as esignService from './service';

const permission = 'files.request_signatures';
const PATHS = ['/documents/signatures'];

export const createSignRequestAction = authedAction(
  { permission, input: createSignRequestSchema, revalidate: PATHS },
  (ctx, input) => esignService.createSignRequest(ctx, input),
);
export const saveDraftAction = authedAction(
  { permission, input: saveDraftSchema, revalidate: PATHS },
  (ctx, input) => esignService.saveDraft(ctx, input),
);
export const sendSignRequestAction = authedAction(
  { permission, input: requestIdSchema, revalidate: PATHS },
  (ctx, input) => esignService.sendSignRequest(ctx, input.id),
);
export const remindSignerAction = authedAction(
  { permission, input: remindSignerSchema, revalidate: PATHS },
  (ctx, input) => esignService.remindSigner(ctx, input),
);
export const voidSignRequestAction = authedAction(
  { permission, input: voidRequestSchema, revalidate: PATHS },
  (ctx, input) => esignService.voidSignRequest(ctx, input),
);
export const deleteDraftAction = authedAction(
  { permission, input: requestIdSchema, revalidate: PATHS },
  (ctx, input) => esignService.deleteDraft(ctx, input.id),
);
export const getSignedDownloadUrlAction = authedAction(
  { permission, input: requestIdSchema },
  (ctx, input) => esignService.getSignedDownloadUrl(ctx, input.id),
);
