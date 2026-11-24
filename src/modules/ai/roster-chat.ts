import 'server-only';

import { FunctionCallingConfigMode, type Content, type FunctionCall } from '@google/genai';
import { z } from 'zod';

import { addDaysToDate, daysBetweenDates } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { formatCalendarDate } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { getRoster, listRosterShifts, listRosterTeams } from '@/modules/roster/queries';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { enforceLimits } from './agent';
import { checkRoster, planVacantFill } from './roster-agent';
import { planRoster } from './roster-planner';
import type { RosterChatInput } from './schemas';
import { DATA_RULE, dataBlock } from './tools/shared';
import type { RosterAgentArtifact } from './types';

/**
 * Follow-up requests to the roster agent, in words (ADR-079): "who is on Tuesday?", "delete all
 * shifts", "fill the vacant shifts", "give Sam's Friday to Alex", "rebuild it cheaper". The
 * reasoning model chooses a tool; every tool either reads the open roster or prepares a proposal
 * the manager confirms with a click. No tool writes, so nothing a model says can change a roster.
 */

const MAX_STEPS = 3;

type Loaded = Awaited<ReturnType<typeof loadRoster>>;

async function loadRoster(ctx: TenantContext, rosterId: string) {
  const roster = await getRoster(ctx, rosterId);
  if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
  const [shifts, members, teams] = await Promise.all([
    listRosterShifts(ctx, roster.id),
    listActiveMembers(ctx),
    listRosterTeams(ctx),
  ]);
  return { roster, shifts, members, teams };
}

const matches = (name: string, wanted: string) => {
  const lower = name.toLowerCase();
  const target = wanted.trim().toLowerCase();
  return lower === target || lower.split(/\s+/).includes(target) || lower.includes(target);
};

function personNamed(loaded: Loaded, name: string) {
  const exact = loaded.members.filter(
    (member) => member.fullName.toLowerCase() === name.trim().toLowerCase(),
  );
  if (exact.length === 1) return { person: exact[0]! };
  const found = loaded.members.filter((member) => matches(member.fullName, name));
  if (found.length === 1) return { person: found[0]! };
  return {
    problem: found.length
      ? `Several people match "${name}": ${found.map((member) => member.fullName).join(', ')}. Ask which one.`
      : `Nobody in the team is called "${name}".`,
  };
}

type ToolOutcome =
  | { kind: 'data'; data: Record<string, unknown> }
  | { kind: 'artifact'; artifact: RosterAgentArtifact; reply: string };

type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  args: z.ZodType;
  run: (args: never, loaded: Loaded, ctx: TenantContext) => Promise<ToolOutcome>;
};

const overviewArgs = z.object({});
const removeArgs = z.object({
  which: z.enum(['all', 'vacant', 'person', 'day', 'team']),
  personName: z.string().trim().max(120).optional(),
  date: z.iso.date().optional(),
  teamName: z.string().trim().max(40).optional(),
});
const reassignArgs = z.object({
  personName: z.string().trim().max(120).optional(),
  date: z.iso.date(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  toPersonName: z.string().trim().max(120).nullable().optional(),
});
const rebuildArgs = z.object({
  start: z.enum(['patterns', 'trading_hours', 'copy_last_week']).default('patterns'),
  priority: z.enum(['even_hours', 'lowest_cost', 'most_productive']).default('even_hours'),
  replaceExisting: z.boolean().default(true),
});

const TOOLS: Tool[] = [
  {
    name: 'roster_overview',
    description:
      'Read the open roster: every shift (day, times, person or vacant, team), hours per person, and the check (vacant shifts, gaps in cover against trading hours, shifts on leave, people over hours). Use it to answer questions about the roster.',
    parameters: { type: 'object', properties: {} },
    args: overviewArgs,
    async run(_args: z.output<typeof overviewArgs>, loaded, ctx) {
      const nameOf = new Map(loaded.members.map((member) => [member.userId, member.fullName]));
      const teamOf = new Map(loaded.teams.map((team) => [team.id, team.name]));
      const check = await checkRoster(ctx, loaded.roster.id);
      const hours = new Map<string, number>();
      for (const shift of loaded.shifts) {
        if (!shift.userId) continue;
        hours.set(shift.userId, (hours.get(shift.userId) ?? 0) + shift.paidMinutes);
      }
      return {
        kind: 'data',
        data: {
          ok: true,
          roster: dataBlock('roster', {
            startsOn: loaded.roster.startsOn,
            endsOn: loaded.roster.endsOn,
            status: loaded.roster.status,
            shifts: loaded.shifts.map((shift) => ({
              date: shift.date,
              start: shift.startTime,
              end: shift.endTime,
              person: shift.userId ? (nameOf.get(shift.userId) ?? 'Former member') : 'vacant',
              team: shift.teamId ? (teamOf.get(shift.teamId) ?? null) : null,
              paidHours: Number((shift.paidMinutes / 60).toFixed(2)),
            })),
            hoursByPerson: [...hours.entries()].map(([userId, minutes]) => ({
              person: nameOf.get(userId) ?? 'Former member',
              hours: Number((minutes / 60).toFixed(2)),
            })),
            teams: loaded.teams.map((team) => ({
              name: team.name,
              members: team.memberIds.length,
            })),
            check: check.findings,
          }),
        },
      };
    },
  },
  {
    name: 'propose_remove_shifts',
    description:
      'Prepare removing shifts from the open roster, for the manager to confirm: all shifts, the vacant ones, one person’s, one day’s, or one team’s. Nothing is removed until they confirm.',
    parameters: {
      type: 'object',
      properties: {
        which: { type: 'string', enum: ['all', 'vacant', 'person', 'day', 'team'] },
        personName: { type: 'string', description: 'For which=person.' },
        date: { type: 'string', description: 'For which=day: YYYY-MM-DD.' },
        teamName: { type: 'string', description: 'For which=team.' },
      },
      required: ['which'],
    },
    args: removeArgs,
    async run(args: z.output<typeof removeArgs>, loaded) {
      let chosen = loaded.shifts;
      let description = `All ${loaded.shifts.length} shifts`;
      if (args.which === 'vacant') {
        chosen = loaded.shifts.filter((shift) => !shift.userId);
        description = `The ${chosen.length} vacant shifts`;
      } else if (args.which === 'person') {
        if (!args.personName)
          return { kind: 'data', data: { ok: false, message: 'Whose shifts?' } };
        const found = personNamed(loaded, args.personName);
        if (!found.person) return { kind: 'data', data: { ok: false, message: found.problem } };
        chosen = loaded.shifts.filter((shift) => shift.userId === found.person.userId);
        description = `${found.person.fullName}’s ${chosen.length} shift${chosen.length === 1 ? '' : 's'}`;
      } else if (args.which === 'day') {
        if (!args.date) return { kind: 'data', data: { ok: false, message: 'Which day?' } };
        chosen = loaded.shifts.filter((shift) => shift.date === args.date);
        description = `The ${chosen.length} shift${chosen.length === 1 ? '' : 's'} on ${formatCalendarDate(args.date)}`;
      } else if (args.which === 'team') {
        const team = loaded.teams.find(
          (item) => item.name.toLowerCase() === (args.teamName ?? '').toLowerCase(),
        );
        if (!team) {
          return {
            kind: 'data',
            data: {
              ok: false,
              message: `There is no team called "${args.teamName ?? ''}".`,
              teams: loaded.teams.map((item) => item.name),
            },
          };
        }
        chosen = loaded.shifts.filter((shift) => shift.teamId === team.id);
        description = `The ${chosen.length} ${team.name} shift${chosen.length === 1 ? '' : 's'}`;
      }
      if (chosen.length === 0) {
        return {
          kind: 'data',
          data: { ok: false, message: 'No shifts on this roster match that.' },
        };
      }
      const nameOf = new Map(loaded.members.map((member) => [member.userId, member.fullName]));
      return {
        kind: 'artifact',
        reply: `${description} will be removed when you confirm. Staff who were shown them are told when you next publish.`,
        artifact: {
          kind: 'remove_shifts',
          rosterId: loaded.roster.id,
          shiftIds: chosen.map((shift) => shift.id),
          description,
          shifts: chosen.map((shift) => ({
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            personName: shift.userId ? (nameOf.get(shift.userId) ?? 'Former member') : null,
          })),
        },
      };
    },
  },
  {
    name: 'propose_fill_vacant',
    description:
      'Work out who can take each vacant shift on the open roster (never on leave, never double-booked, in the shift’s team, ordinary hours capped, contracted hours first), for the manager to approve.',
    parameters: { type: 'object', properties: {} },
    args: overviewArgs,
    async run(_args: z.output<typeof overviewArgs>, loaded, ctx) {
      const plan = await planVacantFill(ctx, loaded.roster.id);
      if (plan.vacant === 0) {
        return { kind: 'data', data: { ok: false, message: 'There are no vacant shifts.' } };
      }
      return {
        kind: 'artifact',
        reply: plan.assignments.length
          ? `I can fill ${plan.assignments.length} of the ${plan.vacant} vacant shifts. Approve to give them out.`
          : `Nobody free can take any of the ${plan.vacant} vacant shifts.`,
        artifact: plan,
      };
    },
  },
  {
    name: 'propose_change_shift',
    description:
      'Prepare giving one shift to someone else, or leaving it vacant (toPersonName null), for the manager to confirm. Identify the shift by its day and the person on it (or its start time).',
    parameters: {
      type: 'object',
      properties: {
        personName: { type: 'string', description: 'Who has the shift now, if anyone.' },
        date: { type: 'string', description: 'YYYY-MM-DD.' },
        startTime: { type: 'string', description: 'HH:MM, when several shifts match.' },
        toPersonName: {
          type: 'string',
          description: 'Who should have it; leave out to make it vacant.',
        },
      },
      required: ['date'],
    },
    args: reassignArgs,
    async run(args: z.output<typeof reassignArgs>, loaded) {
      let candidates = loaded.shifts.filter((shift) => shift.date === args.date);
      let fromName: string | null = null;
      if (args.personName) {
        const found = personNamed(loaded, args.personName);
        if (!found.person) return { kind: 'data', data: { ok: false, message: found.problem } };
        fromName = found.person.fullName;
        candidates = candidates.filter((shift) => shift.userId === found.person.userId);
      }
      if (args.startTime)
        candidates = candidates.filter((shift) => shift.startTime === args.startTime);
      if (candidates.length !== 1) {
        return {
          kind: 'data',
          data: {
            ok: false,
            message: candidates.length
              ? 'Several shifts match: ask for the start time.'
              : 'No shift matches that day and person.',
          },
        };
      }
      const shift = candidates[0]!;
      let to: { userId: string; fullName: string } | null = null;
      if (args.toPersonName) {
        const found = personNamed(loaded, args.toPersonName);
        if (!found.person) return { kind: 'data', data: { ok: false, message: found.problem } };
        to = found.person;
      }
      const nameOf = new Map(loaded.members.map((member) => [member.userId, member.fullName]));
      fromName ??= shift.userId ? (nameOf.get(shift.userId) ?? 'Former member') : null;
      return {
        kind: 'artifact',
        reply: `Confirm to ${to ? `give this shift to ${to.fullName}` : 'leave this shift vacant'}. The roster checks they are free and in the shift’s team.`,
        artifact: {
          kind: 'change_shift',
          shiftId: shift.id,
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          fromName,
          toUserId: to?.userId ?? null,
          toName: to?.fullName ?? null,
        },
      };
    },
  },
  {
    name: 'propose_rebuild',
    description:
      'Plan the open roster again from scratch, for the manager to approve: from the last four weeks’ pattern (patterns), the trading hours’ staff numbers, or last week (copy_last_week); priority decides who goes on first. replaceExisting removes the current shifts first on approval.',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', enum: ['patterns', 'trading_hours', 'copy_last_week'] },
        priority: { type: 'string', enum: ['even_hours', 'lowest_cost', 'most_productive'] },
        replaceExisting: { type: 'boolean' },
      },
    },
    args: rebuildArgs,
    async run(args: z.output<typeof rebuildArgs>, loaded, ctx) {
      const outcome = await planRoster(ctx, {
        startDate: loaded.roster.startsOn,
        endDate: loaded.roster.endsOn,
        strategy: args.start === 'copy_last_week' ? 'copy_last_week' : args.priority,
        source: args.start === 'copy_last_week' ? undefined : args.start,
        contractedFirst: true,
        replacing: args.replaceExisting,
      });
      if (outcome.kind === 'unavailable') {
        return { kind: 'data', data: { ok: false, message: outcome.message } };
      }
      return { kind: 'artifact', artifact: outcome.artifact, reply: outcome.reply };
    },
  },
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

export async function chatAboutRoster(
  ctx: TenantContext,
  input: RosterChatInput,
): Promise<{ reply: string; artifact: RosterAgentArtifact | null }> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'rosters.manage');
  if (!aiService.isConfigured()) {
    throw new AppError(
      'INTERNAL',
      'MeroAI cannot chat until a Gemini API key is set up. Instant build and the start form still work.',
    );
  }
  await enforceLimits(ctx);
  const loaded = await loadRoster(ctx, input.rosterId);
  const days = daysBetweenDates(loaded.roster.startsOn, loaded.roster.endsOn) + 1;
  const dates = Array.from({ length: days }, (_, index) => {
    const date = addDaysToDate(loaded.roster.startsOn, index);
    return `${date} (${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' })})`;
  });

  const systemInstruction = [
    `You are MeroAI’s roster agent inside Meroidea, for ${ctx.tenant.name}. The manager has the roster for ${loaded.roster.startsOn} to ${loaded.roster.endsOn} open; its days are ${dates.join(', ')}.`,
    'Use roster_overview to answer questions about it. To change it, use a propose_ tool: proposals are applied only when the manager confirms them in the app. Never say you changed, removed, filled or published anything yourself.',
    'Weekday names mean the day of that name in this roster. Act rather than ask when a sensible default exists. Reply in short, plain sentences without markdown tables.',
    DATA_RULE,
  ].join('\n');

  const contents: Content[] = [
    ...input.history.map((message) => ({ role: message.role, parts: [{ text: message.text }] })),
    { role: 'user', parts: [{ text: input.prompt }] },
  ];
  const config = {
    systemInstruction,
    tools: [
      {
        functionDeclarations: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })),
      },
    ],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
  };

  let reply = '';
  let artifact: RosterAgentArtifact | null = null;
  const trail: string[] = [];
  let model: string | undefined;
  let fellBack = false;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const final = step === MAX_STEPS;
    const answer = await aiService.generate(
      'reasoning',
      contents,
      final
        ? {
            ...config,
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
          }
        : config,
      { thinking: 'low', timeoutMs: 25_000, model },
    );
    model = answer.model;
    fellBack ||= answer.fellBack;
    const text = aiService.responseText(answer.response);
    const calls: FunctionCall[] = answer.response.functionCalls ?? [];
    if (calls.length === 0) {
      reply = text;
      break;
    }
    const modelTurn = answer.response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);
    const [call, ...rest] = calls;
    const tool = call?.name ? byName.get(call.name) : undefined;
    let response: Record<string, unknown>;
    if (!call || !tool) {
      response = { ok: false, message: 'That tool is not available.' };
      trail.push('unknown');
    } else {
      const parsed = tool.args.safeParse(call.args ?? {});
      if (!parsed.success) {
        response = { ok: false, message: 'The arguments were not valid.' };
        trail.push(`${tool.name}:invalid`);
      } else {
        try {
          const outcome = await tool.run(parsed.data as never, loaded, ctx);
          if (outcome.kind === 'artifact') {
            artifact = outcome.artifact;
            reply = text || outcome.reply;
            trail.push(`${tool.name}:proposal`);
            break;
          }
          response = outcome.data;
          trail.push(`${tool.name}:data`);
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            !['NOT_FOUND', 'VALIDATION', 'CONFLICT'].includes(error.code)
          ) {
            throw error;
          }
          response = { ok: false, message: error.message };
          trail.push(`${tool.name}:refused`);
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [
        { functionResponse: { id: call?.id, name: call?.name ?? 'unknown', response } },
        ...rest.map((extra) => ({
          functionResponse: {
            id: extra.id,
            name: extra.name ?? 'unknown',
            response: { ok: false, message: 'Only one action runs per request; this one did not.' },
          },
        })),
      ],
    });
  }
  if (!reply) reply = 'I could not finish that. Try saying it another way.';

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: loaded.roster.id,
      context: {
        surface: 'roster_agent',
        action: 'chat',
        model: model ?? aiService.modelFor('reasoning'),
        fellBack,
        tools: trail,
        proposal: artifact?.kind ?? null,
      },
    }),
  );
  return { reply, artifact };
}
