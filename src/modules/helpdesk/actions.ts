'use server';

import { authedAction } from '@/server/action';

import {
  createTicketSchema,
  formOpenSchema,
  idSchema,
  replySchema,
  updateTicketSchema,
} from './schemas';
import * as helpdeskService from './service';

const PATHS = ['/helpdesk'];
const work = { permission: 'tickets.work', revalidate: PATHS } as const;
const manage = { permission: 'tickets.manage', revalidate: PATHS } as const;

export const createTicketAction = authedAction(
  { ...work, input: createTicketSchema },
  (ctx, input) => helpdeskService.createTicket(ctx, input),
);
export const replyToTicketAction = authedAction({ ...work, input: replySchema }, (ctx, input) =>
  helpdeskService.replyToTicket(ctx, input),
);
export const updateTicketAction = authedAction(
  { ...work, input: updateTicketSchema },
  (ctx, input) => helpdeskService.updateTicket(ctx, input),
);
export const deleteTicketAction = authedAction({ ...manage, input: idSchema }, (ctx, input) =>
  helpdeskService.deleteTicket(ctx, input.id),
);
export const setFormOpenAction = authedAction({ ...manage, input: formOpenSchema }, (ctx, input) =>
  helpdeskService.setFormOpen(ctx, input.isOpen),
);
