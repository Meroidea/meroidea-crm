'use server';

import { authedAction } from '@/server/action';

import { partnerFieldsSchema, updatePartnerSchema } from './schemas';
import * as partnersService from './service';

export const createPartnerAction = authedAction(
  {
    permission: 'partners.manage',
    input: partnerFieldsSchema,
    revalidate: ['/partners', '/organizations'],
  },
  (ctx, input) => partnersService.createPartner(ctx, input),
);

export const updatePartnerAction = authedAction(
  { permission: 'partners.manage', input: updatePartnerSchema, revalidate: ['/partners'] },
  (ctx, input) => partnersService.updatePartner(ctx, input),
);
