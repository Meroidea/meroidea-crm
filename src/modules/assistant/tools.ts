import 'server-only';

import { tool } from 'ai';
import { z } from 'zod';

import { zonedToday } from '@/lib/dates';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { getDashboard, getReports, listQuietDeals } from '@/modules/reports/queries';
import { countTasks, listTasks } from '@/modules/tasks/queries';
import { hasPermission, type TenantContext } from '@/server/context';

/**
 * The assistant's read-only tools (ADR-063). Each one calls a query the app already uses for its
 * own pages, with the signed-in person's context, so an answer can never reach further than the
 * Dashboard, Reports or Tasks page would show that person: same tenant, same permissions, same
 * own/team/all scope, same money masking. No tool writes anything, and none takes a record id,
 * a user id or a tenant id from the model.
 */

/** What a tool returns when the person lacks the permission behind it, for the model to relay. */
type Unavailable = { unavailable: string };

const unavailable = (what: string): Unavailable => ({
  unavailable: `This person’s role does not include ${what}. Say so plainly; do not guess figures.`,
});

const lacks = (ctx: TenantContext, key: PermissionKey) => !hasPermission(ctx, key);

/** A calendar date in the business's own timezone, which is how people read due dates. */
const zonedDate = (date: Date | null, timeZone: string) =>
  date ? zonedToday(timeZone, date) : null;

/** Blank money means "masked by revenue.view"; say so rather than letting it read as zero. */
const money = (value: string) => (value === '' ? 'hidden' : value);

/** Builds the tools for one request; the context is captured here and never comes from the model. */
export function buildAssistantTools(ctx: TenantContext) {
  const timeZone = ctx.tenant.timezone;

  return {
    get_pipeline_stats: tool({
      description:
        'Current pipeline snapshot: open count and value, weighted value, won this month, ' +
        '90-day win rate, open count and value per stage, top sources (90 days) and the top ' +
        'owners by deals won (90 days). Use for "how is the pipeline", "what is in each stage".',
      inputSchema: z.object({}),
      execute: async () => {
        if (lacks(ctx, 'reports.view')) return unavailable('reports');
        const dashboard = await getDashboard(ctx);
        if (!dashboard) return unavailable('reports');
        return {
          currency: dashboard.currency,
          amountsVisible: dashboard.showMoney,
          kpis: {
            ...dashboard.kpis,
            openValue: money(dashboard.kpis.openValue),
            weightedValue: money(dashboard.kpis.weightedValue),
            wonThisMonthValue: money(dashboard.kpis.wonThisMonthValue),
            winRatePercent90d: dashboard.kpis.winRate,
          },
          openByStage: dashboard.stages.map((stage) => ({
            stage: stage.name,
            count: stage.count,
            value: money(stage.value),
          })),
          topSources90d: dashboard.sources,
          topOwnersByWins90d: dashboard.leaderboard.map((row) => ({
            ...row,
            won: money(row.won),
          })),
        };
      },
    }),

    get_overdue_follow_ups: tool({
      description:
        'Open tasks whose due date has passed, oldest first, plus open deals that have gone ' +
        'quiet for longer than their stage allows. Use for "what am I behind on", "overdue ' +
        'follow-ups", "which deals need attention".',
      inputSchema: z.object({
        assignee: z
          .enum(['me', 'everyone_visible'])
          .default('me')
          .describe('Only my tasks, or every task this person may see under their role.'),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ assignee, limit }) => {
        const result: {
          overdueTasks?: unknown;
          overdueTaskTotal?: number;
          quietOpportunities?: unknown;
          notes: string[];
        } = { notes: [] };

        if (lacks(ctx, 'tasks.view')) {
          result.notes.push(unavailable('tasks').unavailable);
        } else {
          const filters = assignee === 'me' ? { assignee: 'me' as const } : {};
          const [rows, counts] = await Promise.all([
            listTasks(ctx, { ...filters, view: 'overdue' }),
            countTasks(ctx, filters),
          ]);
          result.overdueTaskTotal = counts.overdue;
          result.overdueTasks = rows.slice(0, limit).map((row) => ({
            title: row.title,
            type: row.type,
            priority: row.priority,
            due: zonedDate(row.dueAt, timeZone),
            assignee: row.assigneeName,
            contact: row.contactName,
            opportunity: row.opportunityName,
          }));
        }

        if (lacks(ctx, 'opportunities.view')) {
          result.notes.push(unavailable('opportunities').unavailable);
        } else {
          result.quietOpportunities = (await listQuietDeals(ctx)).map((deal) => ({
            opportunity: deal.name,
            contact: deal.contactName,
            stage: deal.stageName,
            daysWithoutActivity: deal.days,
          }));
        }
        return result;
      },
    }),

    get_sales_report: tool({
      description:
        'Sales report for the last 30, 90 or 365 days: stage funnel, results by source and by ' +
        'owner, average days in each stage, follow-up compliance (on time, late, open, ' +
        'overdue), activity per person and lost reasons.',
      inputSchema: z.object({
        rangeDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(30),
      }),
      execute: async ({ rangeDays }) => {
        if (lacks(ctx, 'reports.view')) return unavailable('reports');
        const report = await getReports(ctx, rangeDays);
        return {
          rangeDays: report.range,
          currency: report.currency,
          amountsVisible: report.showMoney,
          funnel: report.funnel,
          bySource: report.bySource,
          byOwner: report.byOwner.map((row) => ({ ...row, value: money(row.value) })),
          avgDaysInStage: report.timeInStage,
          followUp: report.followUp,
          activityByPerson: report.activityByUser,
          lostReasons: report.lostReasons,
        };
      },
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
export const ASSISTANT_TOOL_NAMES = [
  'get_pipeline_stats',
  'get_overdue_follow_ups',
  'get_sales_report',
] as const satisfies readonly (keyof AssistantTools)[];
