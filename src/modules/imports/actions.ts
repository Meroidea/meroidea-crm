'use server';

import { authedAction } from '@/server/action';

import { finishImportSchema, importChunkSchema, startImportSchema } from './schemas';
import { finishImport, importContactsChunk, startImport } from './service';

export const startImportAction = authedAction(
  { permission: 'contacts.import', input: startImportSchema },
  (ctx, input) => startImport(ctx, input),
);

export const importContactsChunkAction = authedAction(
  {
    permission: 'contacts.import',
    input: importChunkSchema,
    revalidate: ['/contacts', '/dashboard', '/leads'],
  },
  (ctx, input) => importContactsChunk(ctx, input),
);

export const finishImportAction = authedAction(
  {
    permission: 'contacts.import',
    input: finishImportSchema,
    revalidate: ['/imports', '/leads', '/notifications'],
  },
  (ctx, input) => finishImport(ctx, input.batchId),
);
