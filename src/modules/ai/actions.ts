'use server';

import { z } from 'zod';

import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import { authedAction } from '@/server/action';

import { runAssistant } from './agent';
import { chaseOverdueInvoices, draftInvoiceWithMeroAI } from './meroai-invoices';
import { buildRosterWithMeroAI } from './meroai-roster';
import {
  approveNoteSchema,
  approveRosterSchema,
  assistantRequestSchema,
  meroAIInvoiceDraftSchema,
  meroAIRosterSchema,
} from './schemas';
import * as approvals from './service';

/**
 * The assistant's endpoint (ADR-074). A Server Action rather than a route handler
 * (rules/architecture.md): it is still a POST endpoint, and authedAction gives it the same
 * authentication, workspace, permission and input checks as every other mutation. Returns
 * `{ reply, actionTaken, artifact }`; the artifact is a preview that nothing has saved.
 */
export const askAssistantAction = authedAction(
  { permission: 'ai.use', input: assistantRequestSchema },
  (ctx, input) => runAssistant(ctx, input),
);

/** Approvals are the person's own act, so they need the permission of what is saved, not ai.use. */
export const approveInvoiceDraftAction = authedAction(
  { permission: 'invoices.manage', input: saveInvoiceSchema, revalidate: ['/invoices', '/books'] },
  (ctx, input) => approvals.approveInvoiceDraft(ctx, input),
);

export const approveRosterAction = authedAction(
  { permission: 'rosters.manage', input: approveRosterSchema, revalidate: ['/roster'] },
  (ctx, input) => approvals.approveRosterPreview(ctx, input),
);

export const approveNoteAction = authedAction(
  { permission: 'activities.create', input: approveNoteSchema, revalidate: ['/contacts'] },
  (ctx, input) => approvals.approveNote(ctx, input),
);

/** Ask MeroAI on the roster page: a preview built with the chosen way of working (ADR-076). */
export const buildRosterWithMeroAIAction = authedAction(
  { permission: 'rosters.manage', input: meroAIRosterSchema },
  (ctx, input) => buildRosterWithMeroAI(ctx, input),
);

/** Ask MeroAI on the invoices page: an invoice preview from a sentence (ADR-077). */
export const draftInvoiceWithMeroAIAction = authedAction(
  { permission: 'invoices.manage', input: meroAIInvoiceDraftSchema },
  (ctx, input) => draftInvoiceWithMeroAI(ctx, input),
);

/** Ask MeroAI on the invoices page: payment reminders for every overdue invoice (ADR-077). */
export const chaseOverdueInvoicesAction = authedAction(
  { permission: 'invoices.manage', input: z.object({}) },
  (ctx) => chaseOverdueInvoices(ctx),
);
