'use server';

import { authedAction } from '@/server/action';

import {
  acceptHandoverSchema,
  assignLeadsSchema,
  contactIdOnlySchema,
  directConvertSchema,
  handoverSchema,
  leadQueueFiltersSchema,
  linkContactsSchema,
  rejectHandoverSchema,
  setLeadStatusSchema,
  unlinkContactsSchema,
} from './schemas';
import { exportLeads } from './export';
import * as leads from './service';

const paths = ['/contacts', '/leads', '/opportunities', '/pipeline'];

export const setLeadStatusAction = authedAction(
  { permission: 'contacts.edit', input: setLeadStatusSchema, revalidate: paths },
  (ctx, input) => leads.setLeadStatus(ctx, input),
);

export const assignLeadsAction = authedAction(
  { permission: 'contacts.assign', input: assignLeadsSchema, revalidate: paths },
  (ctx, input) => leads.assignLeads(ctx, input),
);

export const handoverLeadAction = authedAction(
  { permission: 'contacts.edit', input: handoverSchema, revalidate: paths },
  (ctx, input) => leads.handoverLead(ctx, input),
);

export const acceptHandoverAction = authedAction(
  { permission: 'opportunities.create', input: acceptHandoverSchema, revalidate: paths },
  (ctx, input) => leads.acceptHandover(ctx, input),
);

export const rejectHandoverAction = authedAction(
  { permission: 'contacts.view', input: rejectHandoverSchema, revalidate: paths },
  (ctx, input) => leads.rejectHandover(ctx, input),
);

export const convertLeadAction = authedAction(
  { permission: 'opportunities.create', input: directConvertSchema, revalidate: paths },
  (ctx, input) => leads.convertLead(ctx, input),
);

export const accountMatchesAction = authedAction(
  { permission: 'contacts.view', input: contactIdOnlySchema },
  (ctx, input) => leads.findAccountMatches(ctx, input.contactId),
);

export const linkContactsAction = authedAction(
  { permission: 'contacts.edit', input: linkContactsSchema, revalidate: ['/contacts'] },
  (ctx, input) => leads.linkContacts(ctx, input),
);

export const unlinkContactsAction = authedAction(
  { permission: 'contacts.edit', input: unlinkContactsSchema, revalidate: ['/contacts'] },
  (ctx, input) => leads.unlinkContacts(ctx, input),
);

export const exportLeadsAction = authedAction(
  { permission: 'contacts.export', input: leadQueueFiltersSchema },
  (ctx, input) => exportLeads(ctx, input),
);
