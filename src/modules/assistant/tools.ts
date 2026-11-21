import 'server-only';

import { tool } from 'ai';
import { z } from 'zod';

import { zonedToday } from '@/lib/dates';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { contactListFiltersSchema } from '@/modules/contacts/schemas';
import { listContacts } from '@/modules/contacts/queries';
import { documentFiltersSchema } from '@/modules/files/schemas';
import { listDocuments } from '@/modules/files/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { opportunityListFiltersSchema } from '@/modules/opportunities/schemas';
import { listOpportunities } from '@/modules/opportunities/queries';
import { organizationListFiltersSchema } from '@/modules/organizations/schemas';
import { listOrganizations } from '@/modules/organizations/queries';
import { getDashboard, getReports, listQuietDeals } from '@/modules/reports/queries';
import { getRosterForDate, listRosterShifts } from '@/modules/roster/queries';
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

/** Search results are for pointing at records, not for exporting them. */
const LIMIT = 10;

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
        'Sales report for the last 30, 90 or 365 days: won this month against the weighted ' +
        'forecast of open deals, stalled deals, the stage funnel, results by source and by ' +
        'owner, average days in each stage, follow-up compliance, activity per person and ' +
        'lost reasons. Use it to write summaries and reports.',
      inputSchema: z.object({
        rangeDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(30),
      }),
      execute: async ({ rangeDays }) => {
        if (lacks(ctx, 'reports.view')) return unavailable('reports');
        const [report, dashboard] = await Promise.all([
          getReports(ctx, rangeDays),
          getDashboard(ctx),
        ]);
        return {
          rangeDays: report.range,
          currency: report.currency,
          amountsVisible: report.showMoney,
          wonVsForecast: dashboard
            ? {
                wonThisMonthCount: dashboard.kpis.wonThisMonthCount,
                wonThisMonthValue: money(dashboard.kpis.wonThisMonthValue),
                openPipelineValue: money(dashboard.kpis.openValue),
                weightedForecastValue: money(dashboard.kpis.weightedValue),
                forecastMethod: 'open amounts × each stage’s win probability',
              }
            : null,
          stalledDeals: (dashboard?.stale ?? []).map((deal) => ({
            opportunity: deal.name,
            contact: deal.contactName,
            stage: deal.stageName,
            daysWithoutActivity: deal.days,
            owner: deal.ownerName,
          })),
          teamTargets: 'Meroidea does not record sales targets yet; say so if asked.',
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

    search_records: tool({
      description:
        'Look up records by name: contacts, organizations (companies), opportunities (deals), ' +
        'library documents, or the roster for a day. Returns at most 10, only those this ' +
        'person may see.',
      inputSchema: z.object({
        type: z.enum(['contacts', 'organizations', 'opportunities', 'documents', 'roster']),
        query: z.string().max(100).optional().describe('Name or part of it.'),
        date: z.string().optional().describe('For roster: YYYY-MM-DD, default today.'),
      }),
      execute: async ({ type, query, date }) => {
        const q = query?.trim() || undefined;
        switch (type) {
          case 'contacts': {
            if (lacks(ctx, 'contacts.view')) return unavailable('contacts');
            const { items } = await listContacts(ctx, contactListFiltersSchema.parse({ q }));
            // Name, status and owner identify the record; email helps address an invoice.
            // Phone numbers and other details stay in the app.
            return {
              contacts: items.slice(0, LIMIT).map((row) => ({
                name: row.fullName,
                status: row.status,
                email: row.email,
                owner: row.ownerName,
                lastActivity: zonedDate(row.lastActivityAt, timeZone),
              })),
            };
          }
          case 'organizations': {
            if (lacks(ctx, 'organizations.view')) return unavailable('organizations');
            const { items } = await listOrganizations(
              ctx,
              organizationListFiltersSchema.parse({ q }),
            );
            return {
              organizations: items.slice(0, LIMIT).map((row) => ({
                name: row.name,
                type: row.type,
                city: row.city,
                country: row.country,
                contacts: row.contactCount,
              })),
            };
          }
          case 'opportunities': {
            if (lacks(ctx, 'opportunities.view')) return unavailable('opportunities');
            const { items } = await listOpportunities(
              ctx,
              opportunityListFiltersSchema.parse({ q }),
            );
            return {
              opportunities: items.slice(0, LIMIT).map((row) => ({
                name: row.name,
                contact: row.contactName,
                stage: row.stageName,
                status: row.status,
                amount: row.amount === null ? 'hidden or not set' : row.amount,
                owner: row.ownerName,
                expectedClose: row.expectedCloseDate,
              })),
            };
          }
          case 'documents': {
            if (lacks(ctx, 'files.view')) return unavailable('the document library');
            const { items } = await listDocuments(ctx, documentFiltersSchema.parse({ q }));
            return {
              documents: items.slice(0, LIMIT).map((row) => ({
                name: `${row.name}.${row.extension}`,
                folder: row.folder,
                updated: zonedDate(row.updatedAt, timeZone),
                updatedBy: row.updatedByName,
              })),
            };
          }
          case 'roster': {
            if (lacks(ctx, 'rosters.view')) return unavailable('rosters');
            const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : zonedToday(timeZone);
            const roster = await getRosterForDate(ctx, day);
            if (!roster)
              return { roster: null, note: `No roster this person can see covers ${day}.` };
            const [shifts, members] = await Promise.all([
              listRosterShifts(ctx, roster.id),
              listActiveMembers(ctx),
            ]);
            const names = new Map(members.map((m) => [m.userId, m.fullName]));
            return {
              roster: { from: roster.startsOn, to: roster.endsOn, status: roster.status },
              shiftsOnDay: shifts
                .filter((shift) => shift.date === day)
                .map((shift) => ({
                  person: shift.userId ? (names.get(shift.userId) ?? 'Former staff') : 'Vacant',
                  start: shift.startTime,
                  end: shift.endTime,
                  published: shift.published,
                })),
            };
          }
        }
      },
    }),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
export const ASSISTANT_TOOL_NAMES = [
  'get_pipeline_stats',
  'get_overdue_follow_ups',
  'get_sales_report',
  'search_records',
] as const satisfies readonly (keyof AssistantTools)[];
