'use server';

import { authedAction } from '@/server/action';

import {
  documentIdSchema,
  downloadSchema,
  finishUploadSchema,
  renameDocumentSchema,
  startUploadSchema,
} from './schemas';
import * as filesService from './service';

const PATHS = ['/documents'];
const manage = { permission: 'files.manage', revalidate: PATHS } as const;

export const startUploadAction = authedAction(
  { permission: 'files.manage', input: startUploadSchema },
  (ctx, input) => filesService.startUpload(ctx, input),
);
export const finishUploadAction = authedAction(
  { ...manage, input: finishUploadSchema },
  (ctx, input) => filesService.finishUpload(ctx, input),
);
export const renameDocumentAction = authedAction(
  { ...manage, input: renameDocumentSchema },
  (ctx, input) => filesService.renameDocument(ctx, input),
);
export const deleteDocumentAction = authedAction(
  { ...manage, input: documentIdSchema },
  (ctx, input) => filesService.deleteDocument(ctx, input.id),
);
export const getDownloadUrlAction = authedAction(
  { permission: 'files.view', input: downloadSchema },
  (ctx, input) => filesService.getDownloadUrl(ctx, input),
);
