'use server';

import { z } from 'zod';

import { saveInvoiceSchema } from '@/modules/invoices/schemas';
import { authedAction } from '@/server/action';

import { runAssistant } from './agent';
import { chaseOverdueInvoices, draftInvoiceWithMeroAI } from './meroai-invoices';
import { buildRosterWithMeroAI } from './meroai-roster';
import { authoriseRosterTimesheets, runPayrollWithMeroAI } from './meroai-payroll';
import { authoriseTimesheets, prepareTimesheetAuthorisation } from './meroai-timesheets';
import {
  applyVacantFill,
  buildRosterWithAgent,
  checkRoster,
  instantBuild,
  planVacantFill,
} from './roster-agent';
import { chatAboutRoster } from './roster-chat';
import {
  approveNoteSchema,
  approveRosterSchema,
  assistantRequestSchema,
  meroAIInvoiceDraftSchema,
  meroAIRosterSchema,
  rosterAgentBuildSchema,
  rosterChatSchema,
  rosterFeedbackSchema,
  rosterIdInputSchema,
  runPayrollSchema,
  timesheetAuthoriseSchema,
  timesheetPrepareSchema,
  vacantFillSchema,
} from './schemas';
import { recordRosterFeedback } from './service';
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

/** The roster agent's plan from its start form (ADR-079); a preview, saved only on approval. */
export const buildRosterWithAgentAction = authedAction(
  { permission: 'rosters.manage', input: rosterAgentBuildSchema },
  (ctx, input) => buildRosterWithAgent(ctx, input),
);

/** A follow-up to the roster agent in words; answers, or a proposal to confirm. */
export const chatAboutRosterAction = authedAction(
  { permission: 'rosters.manage', input: rosterChatSchema },
  (ctx, input) => chatAboutRoster(ctx, input),
);

/** The agent's check of a saved roster: vacant shifts, gaps in cover, leave, hours. */
export const checkRosterAction = authedAction(
  { permission: 'rosters.manage', input: rosterIdInputSchema },
  (ctx, input) => checkRoster(ctx, input.rosterId),
);

/** Who could take each vacant shift; nothing saved. */
export const planVacantFillAction = authedAction(
  { permission: 'rosters.manage', input: rosterIdInputSchema },
  (ctx, input) => planVacantFill(ctx, input.rosterId),
);

export const applyVacantFillAction = authedAction(
  { permission: 'rosters.manage', input: vacantFillSchema, revalidate: ['/roster'] },
  (ctx, input) => applyVacantFill(ctx, input),
);

/** Instant build from the roster's Actions menu: no model, applied as unpublished changes. */
export const instantBuildAction = authedAction(
  { permission: 'rosters.manage', input: rosterIdInputSchema, revalidate: ['/roster'] },
  (ctx, input) => instantBuild(ctx, input.rosterId),
);

export const rosterFeedbackAction = authedAction(
  { permission: 'ai.use', input: rosterFeedbackSchema },
  (ctx, input) => recordRosterFeedback(ctx, input),
);

/** MeroAI's proposed authorisation of a pay period's timesheets (ADR-082); nothing is saved. */
export const prepareTimesheetAuthorisationAction = authedAction(
  { permission: 'timesheets.manage', input: timesheetPrepareSchema },
  (ctx, input) => prepareTimesheetAuthorisation(ctx, input.date),
);

/** The manager's final authorisation of the rows they reviewed. */
export const authoriseTimesheetsAction = authedAction(
  { permission: 'timesheets.manage', input: timesheetAuthoriseSchema, revalidate: ['/timesheets'] },
  (ctx, input) => authoriseTimesheets(ctx, input),
);

/** From the roster: MeroAI authorises the period's timesheets; nothing is locked or paid (ADR-084). */
export const authoriseRosterTimesheetsAction = authedAction(
  {
    permission: 'timesheets.manage',
    input: rosterIdInputSchema,
    revalidate: ['/timesheets', '/roster'],
  },
  (ctx, input) => authoriseRosterTimesheets(ctx, input.rosterId),
);

/** From the pay period view, on the manager's confirmation: pay, release and email. */
export const runPayrollAction = authedAction(
  {
    permission: 'payroll.manage',
    input: runPayrollSchema,
    revalidate: ['/timesheets', '/payroll', '/roster', '/payslips'],
  },
  (ctx, input) => runPayrollWithMeroAI(ctx, input),
);
