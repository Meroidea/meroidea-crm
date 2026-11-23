'use server';

import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import { authedAction } from '@/server/action';

import { runAssistant } from './agent';
import { approveNoteSchema, approveRosterSchema, assistantRequestSchema } from './schemas';
import * as approvals from './service';

/**
 * The assistant's endpoint (ADR-073). A Server Action rather than a route handler
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
