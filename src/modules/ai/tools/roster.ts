import 'server-only';

import { z } from 'zod';

import { addDaysToDate, daysBetweenDates } from '@/lib/dates';
import { listActiveMembers } from '@/modules/members/queries';
import {
  getRosterForDate,
  getRosterRules,
  listRosterLeave,
  listRosterShifts,
  listRosterTeams,
} from '@/modules/roster/queries';
import { hasPermission, type TenantContext } from '@/server/context';

import {
  requirementsFromWeek,
  solveRoster,
  WEEKDAYS,
  type ShiftRequirement,
} from '../roster-solver';
import type { RosterPreviewArtifact } from '../types';
import { feedback, type ToolDefinition } from './shared';

const MAX_DAYS = 14;
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const args = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
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

/** Shifts on any roster covering part of the days from `from` to `to`, both inclusive. */
async function shiftsBetween(ctx: TenantContext, from: string, to: string) {
  const days = daysBetweenDates(from, to) + 1;
  const rosterIds = new Set<string>();
  for (let index = 0; index < days; index += 1) {
    const roster = await getRosterForDate(ctx, addDaysToDate(from, index));
    if (roster) rosterIds.add(roster.id);
  }
  return (await Promise.all([...rosterIds].map((id) => listRosterShifts(ctx, id))))
    .flat()
    .filter((shift) => shift.date >= from && shift.date <= to);
}

/**
 * A roster preview for the manager. The model reads the request into shift requirements; the
 * solver assigns people, avoiding time away, other shifts and lopsided hours. Nothing is saved:
 * approving adds the shifts as unpublished changes, which staff see only once the manager
 * publishes the roster (roster/service.ts), and never replaces a shift already there.
 */
export const generateStaffRosterTool: ToolDefinition<Args> = {
  name: 'generate_staff_roster',
  description: `Build a staff roster preview for the manager to approve. Covers up to ${MAX_DAYS} days. Turn the user's request into shift requirements (weekdays, times in 24-hour HH:MM, how many people). When the user gives no shift times, leave shiftRequirements out: the previous week's shifts are repeated. Staff are assigned automatically, balancing hours and avoiding leave and clashes. Nothing is saved or published until the manager approves.`,
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'First day, YYYY-MM-DD.' },
      endDate: { type: 'string', description: 'Last day, YYYY-MM-DD, inclusive.' },
      shiftRequirements: {
        type: 'array',
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
    const dates = Array.from({ length: days }, (_, index) => addDaysToDate(input.startDate, index));

    const [members, teams, leave, rules] = await Promise.all([
      listActiveMembers(ctx),
      listRosterTeams(ctx),
      listRosterLeave(ctx, input.startDate, input.endDate),
      getRosterRules(ctx),
    ]);

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

    // No times given: repeat the week before, day for day, so "build next week's roster" works
    // without the manager typing out shifts they already set up last week.
    let repeated = false;
    if (requirements.length === 0) {
      const lastWeek = await shiftsBetween(
        ctx,
        addDaysToDate(input.startDate, -7),
        addDaysToDate(input.startDate, -1),
      );
      if (lastWeek.length === 0) {
        return feedback(
          'There is no roster for the week before to repeat. Ask the user which shifts they need: days, times and how many people.',
        );
      }
      requirements.push(...requirementsFromWeek(lastWeek));
      repeated = true;
    }

    let people = members;
    if (input.staffIds?.length || input.staffNames?.length) {
      const ids = new Set(input.staffIds ?? []);
      const names = (input.staffNames ?? []).map((name) => name.toLowerCase());
      people = members.filter(
        (member) =>
          ids.has(member.userId) ||
          names.some((name) => member.fullName.toLowerCase().includes(name)),
      );
      if (people.length === 0) {
        return feedback('None of the people named are active members of this workspace.');
      }
    }

    // Shifts already rostered in the period count towards each person's hours.
    const existing = await shiftsBetween(ctx, input.startDate, input.endDate);

    const result = solveRoster({
      dates,
      requirements,
      people: people.map((person) => ({
        userId: person.userId,
        name: person.fullName,
        teamIds: teams
          .filter((team) => team.memberIds.includes(person.userId))
          .map((team) => team.id),
      })),
      leave,
      existing,
      breakRules: rules.breakRules,
    });

    const nameOf = new Map(members.map((member) => [member.userId, member.fullName]));
    const teamOf = new Map(teams.map((team) => [team.id, team.name]));
    const artifact: RosterPreviewArtifact = {
      kind: 'roster_preview',
      startsOn: input.startDate,
      endsOn: input.endDate,
      shifts: result.shifts.map((shift) => ({
        ...shift,
        personName: shift.userId ? (nameOf.get(shift.userId) ?? null) : null,
        teamName: shift.teamId ? (teamOf.get(shift.teamId) ?? null) : null,
      })),
      people: result.load
        .filter((load) => load.newShifts > 0 || load.existingMinutes > 0)
        .map((load) => ({ ...load, name: nameOf.get(load.userId) ?? 'Unknown' })),
      unfilled: result.unfilled,
      warnings: [
        ...(repeated
          ? ['Shifts repeat the week before; change any of them on the roster after approving.']
          : []),
        ...result.warnings,
        ...(existing.length > 0
          ? [
              `${existing.length} shift${existing.length === 1 ? ' is' : 's are'} already rostered in this period and ${existing.length === 1 ? 'was' : 'were'} left as ${existing.length === 1 ? 'it is' : 'they are'}.`,
            ]
          : []),
      ],
    };
    const filled = result.shifts.length - result.unfilled;
    return {
      kind: 'artifact',
      artifact,
      reply: `Here is a roster preview for ${input.startDate} to ${input.endDate}${repeated ? ', repeating last week\u2019s shifts' : ''}: ${filled} of ${result.shifts.length} shifts filled${result.unfilled ? `, ${result.unfilled} left vacant` : ''}. Approving adds them as unpublished changes; staff see nothing until you publish the roster.`,
      audit: {
        repeatedLastWeek: repeated,
        startsOn: input.startDate,
        endsOn: input.endDate,
        shifts: result.shifts.length,
        unfilled: result.unfilled,
      },
    };
  },
};
