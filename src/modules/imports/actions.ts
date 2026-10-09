'use server';

import { authedAction } from '@/server/action';

import { importChunkSchema } from './schemas';
import { importContactsChunk } from './service';

export const importContactsChunkAction = authedAction(
  {
    permission: 'contacts.import',
    input: importChunkSchema,
    revalidate: ['/contacts', '/dashboard'],
  },
  (ctx, input) => importContactsChunk(ctx, input),
);
