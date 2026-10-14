'use server';

import { authedAction } from '@/server/action';

import {
  contactIdSchema,
  createContactSchema,
  duplicateCheckSchema,
  linkOrganizationSchema,
  mergeContactsSchema,
  unlinkOrganizationSchema,
  updateContactSchema,
} from './schemas';
import { anonymizeContact, mergeContacts } from './privacy';
import * as contactsService from './service';

export const checkContactDuplicatesAction = authedAction(
  { permission: 'contacts.create', input: duplicateCheckSchema },
  (ctx, input) => contactsService.checkDuplicates(ctx, input),
);

export const createContactAction = authedAction(
  { permission: 'contacts.create', input: createContactSchema, revalidate: ['/contacts'] },
  (ctx, input) => contactsService.createContact(ctx, input),
);

export const updateContactAction = authedAction(
  { permission: 'contacts.edit', input: updateContactSchema, revalidate: ['/contacts'] },
  (ctx, input) => contactsService.updateContact(ctx, input),
);

export const deleteContactAction = authedAction(
  { permission: 'contacts.delete', input: contactIdSchema, revalidate: ['/contacts'] },
  (ctx, input) => contactsService.deleteContact(ctx, input.id),
);

export const linkContactOrganizationAction = authedAction(
  {
    permission: 'contacts.edit',
    input: linkOrganizationSchema,
    revalidate: ['/contacts', '/organizations'],
  },
  (ctx, input) => contactsService.linkOrganization(ctx, input),
);

export const unlinkContactOrganizationAction = authedAction(
  {
    permission: 'contacts.edit',
    input: unlinkOrganizationSchema,
    revalidate: ['/contacts', '/organizations'],
  },
  (ctx, input) => contactsService.unlinkOrganization(ctx, input),
);

export const mergeContactsAction = authedAction(
  {
    permission: 'contacts.merge',
    input: mergeContactsSchema,
    revalidate: ['/contacts', '/leads', '/opportunities'],
  },
  (ctx, input) => mergeContacts(ctx, input),
);

export const anonymizeContactAction = authedAction(
  { permission: 'contacts.anonymize', input: contactIdSchema, revalidate: ['/contacts', '/leads'] },
  (ctx, input) => anonymizeContact(ctx, input.id),
);
