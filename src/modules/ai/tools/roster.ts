import 'server-only';

import { z } from 'zod';

import { daysBetweenDates } from '@/lib/dates';
import { listActiveMembers } from '@/modules/members/queries';
import { getRosterForDate, listRosterTeams } from '@/modules/roster/queries';
import { hasPermission } from '@/server/context';

import { planRoster } from '../roster-planner';
import {
  loadRosterForProposal,
  proposeDeleteRoster,
  proposeRemoveShifts,
} from '../roster-proposals';
import { WEEKDAYS, type ShiftRequirement } from '../roster-solver';
import { ROSTER_STRATEGIES } from '../types';
import { feedback, type ToolContext, type ToolDefinition } from './shared';

const MAX_DAYS = 14;
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const args = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  strategy: z.enum(ROSTER_STRATEGIES).optional(),
  shiftRequirements: z
    .array(
      z.object({
        weekdays: z.array(z.enum(WEEKDAYS)).min(1).max(7),
        startTime: clockTime,
        endTime: clockTime,
        staffNeeded: z.number().int().min(1).max(30),
        teamName: z.string().trim().max(40).optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  staffIds: z.array(z.uuid()).max(200).optional(),
  staffNames: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
});

type Args = z.output<typeof args>;

/**
 * A roster preview from the chat, through the same planner as the roster page's Ask MeroAI
 * (roster-planner.ts). The model only turns the person's words into arguments: when they give no
 * shift times, the trading hours (or last week) decide, so it never has to ask when a day starts
 * or ends. Nothing is saved until the manager approves.
 */
export const generateStaffRosterTool: ToolDefinition<Args> = {
  name: 'generate_staff_roster',
  description: `Build a staff roster preview for the manager to approve, for up to ${MAX_DAYS} days. Leave shiftRequirements out unless the user gives specific shift times: the business's trading hours (or last week's shifts) are used. strategy: copy_last_week (same shifts and people as last week), lowest_cost (cheapest staff), most_productive (most reliable staff first) or even_hours (the default). Staff are assigned automatically, avoiding leave and clashes. Nothing is saved or published until the manager approves.`,
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'First day, YYYY-MM-DD.' },
      endDate: { type: 'string', description: 'Last day, YYYY-MM-DD, inclusive.' },
      strategy: { type: 'string', enum: [...ROSTER_STRATEGIES] },
      shiftRequirements: {
        type: 'array',
        description: 'Only when the user gives specific shifts.',
        items: {
          type: 'object',
          properties: {
            weekdays: {
              type: 'array',
              items: { type: 'string', enum: [...WEEKDAYS] },
              description: 'Days this shift runs.',
            },
            startTime: { type: 'string', description: 'HH:MM, 24-hour.' },
            endTime: {
              type: 'string',
              description: 'HH:MM, 24-hour. Earlier than the start means overnight.',
            },
            staffNeeded: { type: 'integer', description: 'How many people on this shift.' },
            teamName: { type: 'string', description: 'A roster team, if the user named one.' },
            note: { type: 'string' },
          },
          required: ['weekdays', 'startTime', 'endTime', 'staffNeeded'],
        },
      },
      staffIds: { type: 'array', items: { type: 'string' }, description: 'Only these people.' },
      staffNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only these people, by name.',
      },
    },
    required: ['startDate', 'endDate'],
  },
  args,
  available: ({ ctx }) => hasPermission(ctx, 'rosters.manage'),

  async run(input, { ctx }) {
    const days = daysBetweenDates(input.startDate, input.endDate) + 1;
    if (days < 1) return feedback('The end date is before the start date.');
    if (days > MAX_DAYS) return feedback(`A roster preview covers at most ${MAX_DAYS} days.`);

    const [members, teams] = await Promise.all([listActiveMembers(ctx), listRosterTeams(ctx)]);

    const requirements: ShiftRequirement[] = [];
    for (const requirement of input.shiftRequirements ?? []) {
      let teamId: string | null = null;
      if (requirement.teamName) {
        const team = teams.find(
          (item) => item.name.toLowerCase() === requirement.teamName!.toLowerCase(),
        );
        if (!team) {
          return feedback(`There is no roster team called "${requirement.teamName}".`, {
            teams: teams.map((item) => item.name),
          });
        }
        teamId = team.id;
      }
      requirements.push({
        weekdays: requirement.weekdays,
        startTime: requirement.startTime,
        endTime: requirement.endTime,
        staffNeeded: requirement.staffNeeded,
        teamId,
        note: requirement.note ?? null,
      });
    }

    let onlyUserIds: string[] | undefined;
    if (input.staffIds?.length || input.staffNames?.length) {
      const ids = new Set(input.staffIds ?? []);
      const names = (input.staffNames ?? []).map((name) => name.toLowerCase());
      onlyUserIds = members
        .filter(
          (member) =>
            ids.has(member.userId) ||
            names.some((name) => member.fullName.toLowerCase().includes(name)),
        )
        .map((member) => member.userId);
      if (onlyUserIds.length === 0) {
        return feedback('None of the people named are active members of this workspace.');
      }
    }

    const outcome = await planRoster(ctx, {
      startDate: input.startDate,
      endDate: input.endDate,
      strategy: input.strategy ?? 'even_hours',
      requirements,
      onlyUserIds,
    });
    if (outcome.kind === 'unavailable') return feedback(outcome.message);
    return {
      kind: 'artifact',
      artifact: outcome.artifact,
      reply: outcome.reply,
      audit: outcome.audit,
    };
  },
};

/** The roster a tool acts on: the one covering `date`, else the one the person has open, else today's. */
async function rosterFor(date: string | undefined, tool: ToolContext) {
  const day = date ?? tool.rosterDate ?? tool.today;
  const roster = await getRosterForDate(tool.ctx, day);
  return { day, roster };
}

const removeArgs = z.object({
  date: z.iso.date().optional(),
  which: z.enum(['all', 'vacant', 'person', 'day', 'team']).default('all'),
  personName: z.string().trim().min(1).max(120).optional(),
  day: z.iso.date().optional(),
  teamName: z.string().trim().min(1).max(40).optional(),
});

/**
 * "Delete all the shifts on the roster" from the drawer (ADR-079): the shifts that would go, as a
 * card the manager confirms. Removing runs only from that click, through the roster service.
 */
export const removeRosterShiftsTool: ToolDefinition<z.output<typeof removeArgs>> = {
  name: 'remove_roster_shifts',
  description:
    'Prepare removing shifts from a roster, for the manager to confirm: all of them (the default), the vacant ones, one person’s, one day’s, or one team’s. Without date, the roster the user has open (or this week’s) is used. Nothing is removed until the user confirms in the app.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description:
          'Any day of the roster, YYYY-MM-DD; leave out for the roster the user has open.',
      },
      which: { type: 'string', enum: ['all', 'vacant', 'person', 'day', 'team'] },
      personName: { type: 'string', description: 'For which=person.' },
      day: { type: 'string', description: 'For which=day: YYYY-MM-DD.' },
      teamName: { type: 'string', description: 'For which=team.' },
    },
  },
  args: removeArgs,
  available: ({ ctx }) => hasPermission(ctx, 'rosters.manage'),

  async run(input, tool) {
    const { day, roster } = await rosterFor(input.date, tool);
    if (!roster) return feedback(`There is no roster covering ${day}.`);
    const proposal = proposeRemoveShifts(await loadRosterForProposal(tool.ctx, roster.id), {
      which: input.which,
      personName: input.personName,
      date: input.day,
      teamName: input.teamName,
    });
    if (!proposal.ok) return feedback(proposal.message, proposal.extra);
    return {
      kind: 'artifact',
      artifact: proposal.artifact,
      reply: proposal.reply,
      audit: { rosterId: roster.id, which: input.which, shifts: proposal.artifact.shiftIds.length },
    };
  },
};

const deleteArgs = z.object({ date: z.iso.date().optional() });

/** "Delete the roster" from the drawer: the roster and its shifts, as a card to confirm. */
export const deleteRosterTool: ToolDefinition<z.output<typeof deleteArgs>> = {
  name: 'delete_roster',
  description:
    'Prepare deleting a whole roster with all its shifts, for the manager to confirm. Use only when they ask to delete the roster itself; to clear its shifts use remove_roster_shifts. Without date, the roster the user has open (or this week’s) is used.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description:
          'Any day of the roster, YYYY-MM-DD; leave out for the roster the user has open.',
      },
    },
  },
  args: deleteArgs,
  available: ({ ctx }) => hasPermission(ctx, 'rosters.manage'),

  async run(input, tool) {
    const { day, roster } = await rosterFor(input.date, tool);
    if (!roster) return feedback(`There is no roster covering ${day}.`);
    const proposal = proposeDeleteRoster(await loadRosterForProposal(tool.ctx, roster.id));
    if (!proposal.ok) return feedback(proposal.message);
    return {
      kind: 'artifact',
      artifact: proposal.artifact,
      reply: proposal.reply,
      audit: { rosterId: roster.id, shifts: proposal.artifact.shifts },
    };
  },
};
