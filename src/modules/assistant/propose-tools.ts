import 'server-only';

import { tool } from 'ai';
import { z } from 'zod';

import { addDaysToDate, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { contactListFiltersSchema } from '@/modules/contacts/schemas';
import { listContacts } from '@/modules/contacts/queries';
import { getLastFromDetails } from '@/modules/invoices/queries';
import { listActiveMembers, listStaffRecipients } from '@/modules/members/queries';
import { opportunityListFiltersSchema } from '@/modules/opportunities/schemas';
import { getOpportunity, listOpportunities } from '@/modules/opportunities/queries';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { getRosterForDate } from '@/modules/roster/queries';
import { ROSTER_SPAN_DAYS, type RosterSpan } from '@/modules/roster/schemas';
import { hasPermission, type TenantContext } from '@/server/context';

import { createPendingAction } from './pending';
import { PAYLOAD_SCHEMAS, type PendingPayload } from './pending-schemas';

/*
 * Meroidea AI's write tools (ADR-064). None of them changes the business: each turns the request
 * into a proposal row and returns it, and the chat shows it as a card with Approve and Cancel.
 * Each checks the permission approval will need, so the assistant does not offer what the person
 * could not approve anyway; approval checks again, through the module service.
 *
 * Names the model passes ("Sam", "Acme deal") are matched only among records this person may see.
 * Anything ambiguous goes back to the model as a question, never as a guess.
 */

const unavailable = (what: string) => ({
  unavailable: `This person’s role does not allow ${what}, so nothing was proposed. Tell them.`,
});

const clarify = (question: string) => ({
  needsClarification: `${question} Ask the person; do not guess.`,
});

const AFTER_PROPOSING =
  'Proposal saved; nothing has changed yet. Tell the person to review the card and press ' +
  'Approve to apply it or Cancel. Do not say it is done.';

const replacesField = z
  .string()
  .optional()
  .describe('When revising an earlier proposal from this conversation, its proposal id.');

const replacesId = (value: string | undefined) =>
  value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;

const lacks = (ctx: TenantContext, key: PermissionKey) => !hasPermission(ctx, key);

/** Exact name first (ignoring case), then a single partial match; otherwise ambiguous. */
function pickByName<T>(
  items: T[],
  name: string,
  nameOf: (item: T) => string,
): { match: T } | { candidates: string[] } {
  const wanted = name.trim().toLowerCase();
  const exact = items.filter((item) => nameOf(item).trim().toLowerCase() === wanted);
  if (exact.length === 1 && exact[0]) return { match: exact[0] };
  const partial = items.filter((item) => nameOf(item).toLowerCase().includes(wanted));
  if (exact.length === 0 && partial.length === 1 && partial[0]) return { match: partial[0] };
  return { candidates: (exact.length > 1 ? exact : partial).slice(0, 8).map(nameOf) };
}

async function propose(ctx: TenantContext, proposal: PendingPayload, replaces: string | null) {
  const parsed = PAYLOAD_SCHEMAS[proposal.kind].safeParse(proposal.payload);
  if (!parsed.success) {
    return {
      invalid: parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      note: 'Nothing was proposed. Fix these or ask the person, then propose again.',
    };
  }
  try {
    const view = await createPendingAction(ctx, proposal, replaces);
    return { proposal: view, next: AFTER_PROPOSING };
  } catch (error) {
    if (error instanceof AppError) return { invalid: [error.message] };
    throw error;
  }
}

export function buildProposeTools(ctx: TenantContext) {
  const today = () => zonedToday(ctx.tenant.timezone);

  return {
    propose_invoice: tool({
      description:
        'Prepare a DRAFT customer invoice for the person to approve. Never sends it. Amounts ' +
        'are decimal strings. Ask for anything essential that is missing (who it is for, ' +
        'what is being charged and how much).',
      inputSchema: z.object({
        customerName: z.string().describe('Who the invoice is for.'),
        customerEmail: z.string().optional(),
        issueDate: z.string().optional().describe('YYYY-MM-DD; defaults to today.'),
        dueDate: z.string().optional().describe('YYYY-MM-DD; defaults to 14 days after issue.'),
        taxRatePercent: z
          .string()
          .optional()
          .describe('e.g. "10"; defaults to the business usual rate.'),
        notes: z.string().optional(),
        lines: z
          .array(
            z.object({
              description: z.string(),
              quantity: z.string().describe('e.g. "2" or "1.5"'),
              unitPrice: z.string().describe('Price for one, e.g. "120.00", tax exclusive.'),
            }),
          )
          .min(1),
        replacesActionId: replacesField,
      }),
      execute: async (input) => {
        if (lacks(ctx, 'invoices.manage')) return unavailable('creating invoices');
        const issueDate = input.issueDate ?? today();
        return propose(
          ctx,
          {
            kind: 'invoice',
            payload: {
              invoice: {
                customerName: input.customerName,
                customerEmail: input.customerEmail ?? null,
                customerAddress: null,
                fromDetails: (await getLastFromDetails(ctx)) ?? ctx.tenant.name,
                issueDate,
                dueDate: input.dueDate ?? addDaysToDate(issueDate, 14),
                taxRate: input.taxRatePercent ?? (ctx.tenant.country === 'AU' ? '10' : '0'),
                notes: input.notes ?? null,
                lines: input.lines,
              },
            },
          } as PendingPayload,
          replacesId(input.replacesActionId),
        );
      },
    }),

    propose_roster: tool({
      description:
        'Prepare roster shifts for the person to approve. They are saved UNPUBLISHED; staff ' +
        'see nothing until someone publishes the roster. Use people’s names as the person ' +
        'said them.',
      inputSchema: z.object({
        periodStartsOn: z
          .string()
          .describe('YYYY-MM-DD first day of the roster week (or fortnight) the shifts are in.'),
        span: z.enum(['week', 'fortnight']).default('week'),
        shifts: z
          .array(
            z.object({
              person: z.string(),
              date: z.string().describe('YYYY-MM-DD'),
              startTime: z.string().describe('24-hour HH:MM'),
              endTime: z.string().describe('24-hour HH:MM; earlier than start = overnight'),
              note: z.string().optional(),
            }),
          )
          .min(1)
          .max(150),
        replacesActionId: replacesField,
      }),
      execute: async (input) => {
        if (lacks(ctx, 'rosters.manage')) return unavailable('building rosters');

        // An existing roster's own period wins, so shifts land on the roster people already use.
        const firstDate = [...input.shifts.map((s) => s.date)].sort()[0] ?? input.periodStartsOn;
        const existing =
          /^\d{4}-\d{2}-\d{2}$/.test(firstDate) && hasPermission(ctx, 'rosters.view')
            ? await getRosterForDate(ctx, firstDate)
            : null;
        const startsOn = existing?.startsOn ?? input.periodStartsOn;
        const span: RosterSpan = existing
          ? addDaysToDate(existing.startsOn, 13) === existing.endsOn
            ? 'fortnight'
            : 'week'
          : input.span;
        const endsOn = existing?.endsOn ?? addDaysToDate(startsOn, ROSTER_SPAN_DAYS[span] - 1);

        const outside = input.shifts.filter((s) => s.date < startsOn || s.date > endsOn);
        if (outside.length) {
          return clarify(
            `These dates are outside the roster period ${startsOn} to ${endsOn}: ${outside
              .map((s) => s.date)
              .join(', ')}. Split them into separate proposals or confirm the period.`,
          );
        }

        const members = await listActiveMembers(ctx);
        const shifts = [];
        for (const shift of input.shifts) {
          const found = pickByName(members, shift.person, (m) => m.fullName);
          if ('candidates' in found) {
            return clarify(
              found.candidates.length
                ? `“${shift.person}” could be: ${found.candidates.join(', ')}. Which one?`
                : `No active staff member is called “${shift.person}”.`,
            );
          }
          shifts.push({
            userId: found.match.userId,
            personName: found.match.fullName,
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            note: shift.note?.trim() || null,
          });
        }
        return propose(
          ctx,
          { kind: 'roster', payload: { startsOn, span, shifts } },
          replacesId(input.replacesActionId),
        );
      },
    }),

    propose_staff_email: tool({
      description:
        'Prepare an email from the business to all staff or to named staff, for the person to ' +
        'approve. Nothing is sent until they approve. Write the body as plain text paragraphs ' +
        'separated by blank lines, without a greeting line (one is added per person).',
      inputSchema: z.object({
        audience: z.enum(['all_staff', 'named_people']),
        names: z.array(z.string()).optional().describe('When audience is named_people.'),
        subject: z.string(),
        body: z.string(),
        replacesActionId: replacesField,
      }),
      execute: async (input) => {
        if (lacks(ctx, 'users.manage')) return unavailable('emailing staff');
        const staff = await listStaffRecipients(ctx);
        let chosen = staff;
        if (input.audience === 'named_people') {
          if (!input.names?.length) return clarify('Who should the email go to?');
          chosen = [];
          for (const name of input.names) {
            const found = pickByName(staff, name, (person) => person.fullName);
            if ('candidates' in found) {
              return clarify(
                found.candidates.length
                  ? `“${name}” could be: ${found.candidates.join(', ')}. Which one?`
                  : `No active staff member is called “${name}”.`,
              );
            }
            if (!chosen.includes(found.match)) chosen.push(found.match);
          }
        }
        if (chosen.length === 0) return clarify('There are no active staff to email.');
        return propose(
          ctx,
          {
            kind: 'staff_email',
            payload: {
              recipients: chosen.map((person) => ({
                userId: person.userId,
                name: person.fullName,
                email: person.email,
              })),
              subject: input.subject,
              body: input.body,
            },
          },
          replacesId(input.replacesActionId),
        );
      },
    }),

    propose_record_update: tool({
      description:
        'Prepare a CRM change for the person to approve: move an opportunity to another stage, ' +
        'or create a task / follow-up (optionally linked to a contact or opportunity).',
      inputSchema: z.object({
        change: z.enum(['move_stage', 'create_task']),
        opportunity: z
          .string()
          .optional()
          .describe('Opportunity name; required for move_stage, optional link for a task.'),
        stage: z.string().optional().describe('Target stage name, for move_stage.'),
        lostReason: z.string().optional().describe('Required when moving to a lost stage.'),
        title: z.string().optional().describe('Task title, for create_task.'),
        taskType: z
          .enum(['follow_up', 'call', 'email', 'meeting', 'document', 'other'])
          .default('follow_up'),
        priority: z.enum(['low', 'normal', 'high']).default('normal'),
        dueDate: z.string().optional().describe('YYYY-MM-DD'),
        assignee: z.string().optional().describe('Staff name; defaults to the person asking.'),
        contact: z.string().optional().describe('Contact name to link the task to.'),
        replacesActionId: replacesField,
      }),
      execute: async (input) => {
        const replaces = replacesId(input.replacesActionId);

        const findOpportunity = async (name: string) => {
          if (lacks(ctx, 'opportunities.view')) return null;
          const { items } = await listOpportunities(
            ctx,
            opportunityListFiltersSchema.parse({ q: name }),
          );
          return pickByName(items, name, (item) => item.name);
        };

        if (input.change === 'move_stage') {
          if (lacks(ctx, 'opportunities.edit')) return unavailable('moving opportunities');
          if (!input.opportunity || !input.stage) {
            return clarify('Which opportunity, and to which stage?');
          }
          const found = await findOpportunity(input.opportunity);
          if (!found || 'candidates' in found) {
            return clarify(
              found?.candidates.length
                ? `“${input.opportunity}” could be: ${found.candidates.join(', ')}. Which one?`
                : `No opportunity called “${input.opportunity}” that this person can see.`,
            );
          }
          const detail = await getOpportunity(ctx, found.match.id);
          const pipeline = await getPipelineConfig(ctx, detail.pipelineId);
          const stages = pipeline.stages.filter((stage) => stage.isActive);
          const stage = pickByName(stages, input.stage, (s) => s.name);
          if ('candidates' in stage) {
            return clarify(
              `Stages in this pipeline: ${stages.map((s) => s.name).join(', ')}. Which one?`,
            );
          }
          if (stage.match.id === found.match.stageId) {
            return clarify(`It is already in ${stage.match.name}.`);
          }
          let lostReason: { id: string; name: string } | null = null;
          if (stage.match.category === 'lost') {
            const reasons = pipeline.lostReasons;
            const picked = input.lostReason
              ? pickByName(reasons, input.lostReason, (r) => r.name)
              : { candidates: reasons.map((r) => r.name) };
            if ('candidates' in picked) {
              return clarify(
                `Moving to a lost stage needs a reason: ${picked.candidates.join(', ')}.`,
              );
            }
            lostReason = picked.match;
          }
          return propose(
            ctx,
            {
              kind: 'record_update',
              payload: {
                change: 'move_stage',
                opportunityId: found.match.id,
                opportunityName: found.match.name,
                fromStageName: found.match.stageName,
                stageId: stage.match.id,
                stageName: stage.match.name,
                lostReasonId: lostReason?.id ?? null,
                lostReasonName: lostReason?.name ?? null,
              },
            },
            replaces,
          );
        }

        if (lacks(ctx, 'tasks.manage')) return unavailable('creating tasks');
        if (!input.title) return clarify('What should the task say?');

        let assignee: { userId: string; fullName: string } | null = null;
        if (input.assignee) {
          const found = pickByName(await listActiveMembers(ctx), input.assignee, (m) => m.fullName);
          if ('candidates' in found) {
            return clarify(
              found.candidates.length
                ? `“${input.assignee}” could be: ${found.candidates.join(', ')}. Which one?`
                : `No active staff member is called “${input.assignee}”.`,
            );
          }
          if (found.match.userId !== ctx.userId && lacks(ctx, 'tasks.assign_others')) {
            return unavailable('giving tasks to other people');
          }
          assignee = found.match;
        }

        let contact: { id: string; fullName: string } | null = null;
        if (input.contact) {
          if (lacks(ctx, 'contacts.view')) return unavailable('linking tasks to contacts');
          const { items } = await listContacts(
            ctx,
            contactListFiltersSchema.parse({ q: input.contact }),
          );
          const found = pickByName(items, input.contact, (c) => c.fullName);
          if ('candidates' in found) {
            return clarify(
              found.candidates.length
                ? `“${input.contact}” could be: ${found.candidates.join(', ')}. Which one?`
                : `No contact called “${input.contact}” that this person can see.`,
            );
          }
          contact = found.match;
        }

        let opportunity: { id: string; name: string } | null = null;
        if (input.opportunity) {
          const found = await findOpportunity(input.opportunity);
          if (!found || 'candidates' in found) {
            return clarify(
              found?.candidates.length
                ? `“${input.opportunity}” could be: ${found.candidates.join(', ')}. Which one?`
                : `No opportunity called “${input.opportunity}” that this person can see.`,
            );
          }
          opportunity = found.match;
        }

        return propose(
          ctx,
          {
            kind: 'record_update',
            payload: {
              change: 'create_task',
              title: input.title,
              taskType: input.taskType,
              priority: input.priority,
              dueDate: input.dueDate ?? null,
              assignedTo: assignee?.userId ?? null,
              assigneeName: assignee?.fullName ?? null,
              contactId: contact?.id ?? null,
              contactName: contact?.fullName ?? null,
              opportunityId: opportunity?.id ?? null,
              opportunityName: opportunity?.name ?? null,
            },
          },
          replaces,
        );
      },
    }),
  };
}

export const PROPOSE_TOOL_NAMES = [
  'propose_invoice',
  'propose_roster',
  'propose_staff_email',
  'propose_record_update',
] as const;
