'use server';

import { authedAction } from '@/server/action';

import {
  conversationTicketSchema,
  createTicketSchema,
  formOpenSchema,
  idSchema,
  replySchema,
  slaSettingsSchema,
  ticketOpportunitySchema,
  ticketOrganizationSchema,
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

/** Opens a ticket for an inbox conversation (ADR-069). */
export const createTicketFromConversationAction = authedAction(
  {
    permission: 'tickets.work',
    input: conversationTicketSchema,
    revalidate: [...PATHS, '/social'],
  },
  (ctx, input) => helpdeskService.createTicketFromConversation(ctx, input),
);
export const setTicketOrganizationAction = authedAction(
  { ...work, input: ticketOrganizationSchema },
  (ctx, input) => helpdeskService.setTicketOrganization(ctx, input),
);
export const setTicketOpportunityAction = authedAction(
  { ...work, input: ticketOpportunitySchema },
  (ctx, input) => helpdeskService.setTicketOpportunity(ctx, input),
);
export const saveSlaSettingsAction = authedAction(
  { ...manage, input: slaSettingsSchema },
  (ctx, input) => helpdeskService.saveSlaSettings(ctx, input),
);
