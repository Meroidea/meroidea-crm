import 'server-only';

import { z } from 'zod';

import { daysBetweenDates } from '@/lib/dates';
import { getBoard } from '@/modules/opportunities/queries';
import { listTasks } from '@/modules/tasks/queries';
import { aiService } from '@/server/ai';
import { hasPermission } from '@/server/context';

import type { NextAction, NextActionsArtifact } from '../types';
import { DATA_RULE, dataBlock, truncate, type ToolDefinition } from './shared';

const args = z.object({ focus: z.string().trim().max(200).optional() });
type Args = z.output<typeof args>;

const MAX_ITEMS = 25;

const suggestionsSchema = z.object({
  actions: z
    .array(
      z.object({
        ref: z.string().regex(/^[DT]\d{1,3}$/),
        priority: z.enum(['high', 'medium', 'low']),
        title: z.string().trim().min(1).max(140),
        reason: z.string().trim().min(1).max(400),
      }),
    )
    .max(10),
});

const suggestionsJsonSchema = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'The ref of the item this is about, e.g. D3 or T1.' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: {
            type: 'string',
            description: 'A short instruction, e.g. "Call Ana about the quote".',
          },
          reason: { type: 'string', description: 'Why now, citing the data.' },
        },
        required: ['ref', 'priority', 'title', 'reason'],
      },
    },
  },
  required: ['actions'],
};

type Item = { ref: string; href: string; label: string; data: Record<string, unknown> };

/**
 * Prioritised next steps from the person's own pipeline and tasks, read through the modules' own
 * scoped queries, so a rep only hears about deals they can see. Items go to the model under short
 * refs (D1, T1) rather than ids: it cannot point at a record it was not given, and every link in
 * the answer is built here from the item, never written by the model.
 */
export const suggestNextActionsTool: ToolDefinition<Args> = {
  name: 'suggest_next_actions',
  description:
    'Suggest prioritised next-best actions from the user’s open deals, stalled pipeline stages, deals past their expected close date, and overdue follow-ups.',
  parameters: {
    type: 'object',
    properties: { focus: { type: 'string', description: 'Anything the user wants to focus on.' } },
  },
  args,
  available: ({ ctx }) =>
    hasPermission(ctx, 'opportunities.view') || hasPermission(ctx, 'tasks.view'),

  async run(input, { ctx, today }) {
    const items: Item[] = [];
    const now = Date.now();
    const daysAgo = (value: Date | null) =>
      value ? Math.floor((now - value.getTime()) / 86_400_000) : null;

    if (hasPermission(ctx, 'opportunities.view')) {
      const board = await getBoard(ctx, {});
      const cards = board.columns
        .flatMap((column) => column.cards)
        .filter((card) => card.status === 'open')
        .map((card) => ({
          card,
          pastClose: card.expectedCloseDate !== null && card.expectedCloseDate < today,
        }))
        .filter(({ card, pastClose }) => card.isStale || pastClose)
        .sort((a, b) => b.card.daysInStage - a.card.daysInStage)
        .slice(0, MAX_ITEMS);
      cards.forEach(({ card, pastClose }, index) => {
        items.push({
          ref: `D${index + 1}`,
          href: `/opportunities/${card.id}`,
          label: card.name,
          data: {
            ref: `D${index + 1}`,
            deal: truncate(card.name, 120),
            contact: truncate(card.contactName, 80),
            stage: card.stageName,
            daysInStage: card.daysInStage,
            stalled: card.isStale,
            daysSinceLastActivity: daysAgo(card.lastActivityAt),
            amount: card.amount ? `${card.amount} ${card.currency ?? board.currency}` : null,
            expectedClose: card.expectedCloseDate,
            daysPastExpectedClose: pastClose
              ? daysBetweenDates(card.expectedCloseDate!, today)
              : null,
            nextTaskDue: card.nextTaskDueAt ? card.nextTaskDueAt.toISOString().slice(0, 10) : null,
            owner: card.ownerName,
          },
        });
      });
    }

    if (hasPermission(ctx, 'tasks.view')) {
      const overdue = (await listTasks(ctx, { view: 'overdue' })).slice(0, MAX_ITEMS);
      overdue.forEach((task, index) => {
        items.push({
          ref: `T${index + 1}`,
          href: task.opportunityId
            ? `/opportunities/${task.opportunityId}`
            : task.contactId
              ? `/contacts/${task.contactId}`
              : '/tasks?view=overdue',
          label: task.title,
          data: {
            ref: `T${index + 1}`,
            task: truncate(task.title, 140),
            type: task.type,
            priority: task.priority,
            daysOverdue: daysAgo(task.dueAt),
            contact: truncate(task.contactName, 80),
            deal: truncate(task.opportunityName, 120),
            assignee: task.assigneeName,
          },
        });
      });
    }

    if (items.length === 0) {
      const artifact: NextActionsArtifact = { kind: 'next_actions', actions: [] };
      return {
        kind: 'artifact',
        artifact,
        reply: 'Nothing is stalled, past its expected close date or overdue. You are up to date.',
        audit: { items: 0, suggestions: 0 },
      };
    }

    const result = await aiService.generateJson('reasoning', {
      systemInstruction: [
        `You are a sales and operations coach for ${ctx.tenant.name}. Today is ${today}.`,
        'From the items given, choose up to 8 next actions, most important first. Weigh deal value, how long it has stalled, days overdue and task priority. Each action must cite one item by its ref. Be specific and practical; do not invent facts.',
        DATA_RULE,
      ].join('\n'),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                input.focus ? `Focus: ${input.focus}` : '',
                dataBlock(
                  'items',
                  items.map((item) => item.data),
                ),
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
        },
      ],
      jsonSchema: suggestionsJsonSchema,
      schema: suggestionsSchema,
      thinking: 'low',
    });

    const byRef = new Map(items.map((item) => [item.ref, item]));
    const actions: NextAction[] = result.actions.flatMap((action) => {
      const item = byRef.get(action.ref);
      // A ref the model made up is dropped rather than shown without a record behind it.
      if (!item) return [];
      return [
        {
          priority: action.priority,
          title: action.title,
          reason: action.reason,
          href: item.href,
          recordLabel: item.label,
        },
      ];
    });
    const artifact: NextActionsArtifact = { kind: 'next_actions', actions };
    return {
      kind: 'artifact',
      artifact,
      reply: actions.length
        ? `Here are ${actions.length} next steps, most important first, from ${items.length} stalled deals and overdue follow-ups.`
        : 'I could not turn your pipeline into clear next steps this time. Please try again.',
      audit: { items: items.length, suggestions: actions.length },
    };
  },
};
