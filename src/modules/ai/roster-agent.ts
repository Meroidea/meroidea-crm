import 'server-only';

import { addDaysToDate, daysBetweenDates } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { formatCalendarDate } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { formatHours } from '@/modules/roster/hours';
import { leaveOn } from '@/modules/roster/insights';
import {
  getRoster,
  getRosterRules,
  listContractedMinutes,
  listEarlierRosters,
  listRosterLeave,
  listRosterShifts,
  listRosterTeams,
} from '@/modules/roster/queries';
import { reassignShift } from '@/modules/roster/service';
import { getTradingHours } from '@/modules/trading-hours/queries';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { enforceLimits } from './agent';
import { readRosterNotes } from './meroai-roster';
import { coverageGaps, demandByDate, type CoverageGap } from './roster-coverage';
import { planRoster, rosterStrategyOptions, shiftsBetween } from './roster-planner';
import { solveRoster, weekdayOf, type ShiftRequirement } from './roster-solver';
import type { RosterAgentBuildInput, VacantFillInput } from './schemas';
import { approveRosterPreview } from './service';
import type {
  FillVacantArtifact,
  RosterCheck,
  RosterPreviewArtifact,
  RosterStrategy,
} from './types';

/**
 * The roster agent (ADR-079): a docked panel on the roster page that builds a whole roster from
 * the business's own patterns, explains its plan, applies it when the manager approves, checks the
 * result, and then takes follow-up requests in words (roster-chat.ts). Building, filling and
 * checking are all planned in code; a model only reads the manager's notes and chat.
 */

const ORDINARY_MINUTES_PER_WEEK = 38 * 60;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Copyable rosters and whether the agent's options can run, for the start form. */
export async function rosterAgentSetup(ctx: TenantContext, startsOn: string) {
  requirePermission(ctx, 'rosters.manage');
  const [strategies, earlier, contracted, tradingDays] = await Promise.all([
    rosterStrategyOptions(ctx, startsOn),
    listEarlierRosters(ctx, startsOn),
    listContractedMinutes(ctx),
    getTradingHours(ctx),
  ]);
  return {
    strategies: strategies.options.filter((option) => option.key !== 'copy_last_week'),
    tradingHoursSet: strategies.tradingHoursSet,
    staffCountsSet: tradingDays.some((day) => day.opensAt !== null),
    earlierRosters: earlier.map((roster) => ({
      id: roster.id,
      startsOn: roster.startsOn,
      endsOn: roster.endsOn,
    })),
    contracted:
      contracted === null
        ? ({ available: false, reason: 'Needs access to staff contracts.' } as const)
        : Object.keys(contracted).length === 0
          ? ({
              available: false,
              reason: 'Nobody has contracted weekly hours on a full- or part-time contract yet.',
            } as const)
          : ({ available: true, reason: null } as const),
  };
}

export type RosterAgentSetup = Awaited<ReturnType<typeof rosterAgentSetup>>;

/**
 * Builds the agent's plan: a preview the manager reads and approves, never a change by itself.
 * "MeroAI figures it out" learns the last four weeks (or covers the trading hours' staff numbers
 * when asked to); "Use something saved" copies a roster the manager picks.
 */
export async function buildRosterWithAgent(
  ctx: TenantContext,
  input: RosterAgentBuildInput,
): Promise<{ reply: string; artifact: RosterPreviewArtifact }> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'rosters.manage');
  await enforceLimits(ctx);

  const days = input.span === 'fortnight' ? 14 : 7;
  const endDate = addDaysToDate(input.startsOn, days - 1);
  let copyFrom: { from: string; to: string } | undefined;
  if (input.start === 'saved') {
    const earlier = await listEarlierRosters(ctx, input.startsOn, 52);
    const chosen = earlier.find((roster) => roster.id === input.copyRosterId);
    if (!chosen) throw new AppError('NOT_FOUND', 'Choose one of your earlier rosters to copy.');
    copyFrom = { from: chosen.startsOn, to: chosen.endsOn };
  }

  const notes = await readRosterNotes(ctx, {
    startsOn: input.startsOn,
    days,
    instructions: input.instructions,
    file: input.file,
  });
  // The notes may ask for a way of choosing people ("minimum wages"); it wins over the default
  // when it can run, and is reported when it cannot.
  let strategy: RosterStrategy = input.priority;
  const warnings = [...notes.warnings];
  if (notes.priority && notes.priority !== input.priority) {
    const options = (await rosterStrategyOptions(ctx, input.startsOn)).options;
    const option = options.find((item) => item.key === notes.priority);
    if (option?.available) strategy = notes.priority;
    else if (option?.reason) warnings.push(`MeroAI could not follow your note: ${option.reason}`);
  }

  const outcome = await planRoster(ctx, {
    startDate: input.startsOn,
    endDate,
    strategy,
    source: input.start === 'saved' ? 'copy' : input.useStaffCounts ? 'trading_hours' : 'patterns',
    copyFrom,
    contractedFirst: input.contractedFirst,
    replacing: input.replaceExisting,
    onlyUserIds: notes.onlyUserIds,
    unavailable: notes.unavailable,
    extraWarnings: warnings,
  });
  if (outcome.kind === 'unavailable') throw new AppError('CONFLICT', outcome.message);

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      context: {
        surface: 'roster_agent',
        action: 'build',
        ...outcome.audit,
        start: input.start,
        contractedFirst: input.contractedFirst,
        useStaffCounts: input.useStaffCounts,
        replaceExisting: input.replaceExisting,
        instructionsRead: notes.read,
        attachment: input.file ? { bytes: input.file.size } : null,
        model: notes.read ? aiService.modelFor('fast') : null,
      },
    }),
  );

  const from = formatCalendarDate(input.startsOn);
  const to = formatCalendarDate(endDate);
  const basis =
    outcome.artifact.source === 'copy' && copyFrom
      ? `copying your roster for ${formatCalendarDate(copyFrom.from)} to ${formatCalendarDate(copyFrom.to)}`
      : outcome.artifact.source === 'patterns'
        ? 'the pattern of your last four weeks of rosters'
        : outcome.artifact.source === 'trading_hours'
          ? 'your trading hours and the staff you need on'
          : 'last week’s roster';
  return {
    reply: `I’ll build a roster for ${from} to ${to}, based on ${basis}. Here is my plan. When you approve it, I’ll add the shifts as unpublished changes, check the roster and tell you what still needs you. Staff see nothing until you publish.`,
    artifact: { ...outcome.artifact, notesApplied: notes.applied },
  };
}

/**
 * The check the agent runs after every change (Tanda-style "validating roster"): what is still
 * vacant, where fewer people are on than the trading hours ask for, who is rostered while away,
 * and who is over their ordinary hours. In code, from the saved roster.
 */
export async function checkRoster(ctx: TenantContext, rosterId: string): Promise<RosterCheck> {
  requirePermission(ctx, 'rosters.manage');
  const roster = await getRoster(ctx, rosterId);
  if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
  const days = daysBetweenDates(roster.startsOn, roster.endsOn) + 1;
  const dates = Array.from({ length: days }, (_, index) => addDaysToDate(roster.startsOn, index));
  const [shifts, members, leave, tradingDays, contracted] = await Promise.all([
    listRosterShifts(ctx, roster.id),
    listActiveMembers(ctx),
    listRosterLeave(ctx, roster.startsOn, roster.endsOn),
    getTradingHours(ctx),
    listContractedMinutes(ctx),
  ]);
  const nameOf = new Map(members.map((member) => [member.userId, member.fullName]));
  const tradingHoursSet = tradingDays.some((day) => day.opensAt !== null);
  const gaps: CoverageGap[] = tradingHoursSet ? coverageGaps(tradingDays, dates, shifts) : [];
  const neededMinutes = tradingHoursSet
    ? Object.values(demandByDate(tradingDays, dates)).reduce((sum, value) => sum + value, 0)
    : null;
  const vacant = shifts.filter((shift) => !shift.userId);
  const onLeave = shifts.filter((shift) => leaveOn(leave, shift.userId, shift.date));
  const minutes = new Map<string, number>();
  for (const shift of shifts) {
    if (shift.userId)
      minutes.set(shift.userId, (minutes.get(shift.userId) ?? 0) + shift.paidMinutes);
  }
  const weeks = Math.ceil(days / 7);
  const overHours = [...minutes.entries()]
    .filter(([, total]) => total > ORDINARY_MINUTES_PER_WEEK * weeks)
    .map(([userId, total]) => ({ name: nameOf.get(userId) ?? 'Former member', minutes: total }));
  const shortOfContract = contracted
    ? Object.entries(contracted)
        .filter(([userId]) => nameOf.has(userId))
        .map(([userId, perWeek]) => ({
          name: nameOf.get(userId)!,
          minutes: minutes.get(userId) ?? 0,
          contracted: perWeek * weeks,
        }))
        .filter((person) => person.minutes < person.contracted)
    : [];

  const findings: string[] = [];
  if (vacant.length) {
    findings.push(
      `${plural(vacant.length, 'shift')} ${vacant.length === 1 ? 'is' : 'are'} still vacant (${formatHours(vacant.reduce((sum, shift) => sum + shift.paidMinutes, 0))}).`,
    );
  }
  for (const gap of gaps.slice(0, 6)) {
    findings.push(
      `${formatCalendarDate(gap.date)} from ${gap.from} to ${gap.to} is short by ${plural(gap.short, 'person', 'people')}.`,
    );
  }
  if (gaps.length > 6) findings.push(`And ${plural(gaps.length - 6, 'more gap')} in cover.`);
  if (onLeave.length) {
    findings.push(
      `${plural(onLeave.length, 'shift')} ${onLeave.length === 1 ? 'is' : 'are'} rostered on someone’s leave.`,
    );
  }
  for (const person of overHours) {
    findings.push(
      `${person.name} is rostered ${formatHours(person.minutes)}, over ordinary hours.`,
    );
  }
  for (const person of shortOfContract.slice(0, 5)) {
    findings.push(
      `${person.name} has ${formatHours(person.minutes)} of ${formatHours(person.contracted)} contracted.`,
    );
  }

  return {
    rosterId: roster.id,
    startsOn: roster.startsOn,
    endsOn: roster.endsOn,
    shifts: shifts.length,
    vacant: vacant.length,
    rosteredMinutes: shifts.reduce((sum, shift) => sum + (shift.userId ? shift.paidMinutes : 0), 0),
    neededMinutes,
    gaps,
    onLeave: onLeave.length,
    findings,
  };
}

/**
 * Who could take each vacant shift on a roster, planned by the same solver and rules as a whole
 * roster: never on leave, never double-booked, one shift a day, in the shift's team, ordinary
 * hours capped, contracted hours first where known. Nothing is saved.
 */
export async function planVacantFill(
  ctx: TenantContext,
  rosterId: string,
): Promise<FillVacantArtifact> {
  requirePermission(ctx, 'rosters.manage');
  const roster = await getRoster(ctx, rosterId);
  if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
  if (roster.authorisedAt) {
    throw new AppError('CONFLICT', 'This roster has been authorised for pay and is locked.');
  }
  const days = daysBetweenDates(roster.startsOn, roster.endsOn) + 1;
  const dates = Array.from({ length: days }, (_, index) => addDaysToDate(roster.startsOn, index));
  const [shifts, around, members, teams, leave, rules, contracted] = await Promise.all([
    listRosterShifts(ctx, roster.id),
    shiftsBetween(ctx, roster.startsOn, roster.endsOn),
    listActiveMembers(ctx),
    listRosterTeams(ctx),
    listRosterLeave(ctx, roster.startsOn, roster.endsOn),
    getRosterRules(ctx),
    listContractedMinutes(ctx),
  ]);
  const vacant = shifts.filter((shift) => !shift.userId);
  const requirements: ShiftRequirement[] = vacant.map((shift) => ({
    weekdays: [weekdayOf(shift.date)],
    dates: [shift.date],
    startTime: shift.startTime,
    endTime: shift.endTime,
    staffNeeded: 1,
    teamId: shift.teamId,
    note: shift.note,
    ref: shift.id,
  }));
  const weeks = Math.ceil(days / 7);
  const result = solveRoster({
    dates,
    requirements,
    people: members.map((member) => ({
      userId: member.userId,
      name: member.fullName,
      teamIds: teams
        .filter((team) => team.memberIds.includes(member.userId))
        .map((team) => team.id),
    })),
    leave,
    existing: around.filter((shift) => shift.userId),
    breakRules: rules.breakRules,
    maxMinutesPerPerson: ORDINARY_MINUTES_PER_WEEK * weeks,
    targets: contracted
      ? Object.fromEntries(Object.entries(contracted).map(([id, minutes]) => [id, minutes * weeks]))
      : undefined,
  });
  const nameOf = new Map(members.map((member) => [member.userId, member.fullName]));
  const teamOf = new Map(teams.map((team) => [team.id, team.name]));
  const assignments = result.shifts.flatMap((planned) =>
    planned.userId && planned.ref
      ? [
          {
            shiftId: planned.ref,
            userId: planned.userId,
            personName: nameOf.get(planned.userId) ?? 'Unknown',
            teamName: planned.teamId ? (teamOf.get(planned.teamId) ?? null) : null,
            date: planned.date,
            startTime: planned.startTime,
            endTime: planned.endTime,
          },
        ]
      : [],
  );
  return {
    kind: 'fill_vacant',
    rosterId: roster.id,
    vacant: vacant.length,
    assignments,
    warnings:
      vacant.length === 0 ? ['There are no vacant shifts on this roster.'] : result.warnings,
  };
}

/**
 * Gives the planned people their vacant shifts, one at a time through the roster service, so each
 * meets every rule again; a shift that changed meanwhile is reported, not forced.
 */
export async function applyVacantFill(
  ctx: TenantContext,
  input: VacantFillInput,
): Promise<{ filled: number; skipped: { shiftId: string; reason: string }[] }> {
  requirePermission(ctx, 'rosters.manage');
  const roster = await getRoster(ctx, input.rosterId);
  if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
  const current = new Map(
    (await listRosterShifts(ctx, roster.id)).map((shift) => [shift.id, shift]),
  );
  let filled = 0;
  const skipped: { shiftId: string; reason: string }[] = [];
  for (const assignment of input.assignments) {
    const shift = current.get(assignment.shiftId);
    if (!shift || shift.userId) {
      skipped.push({ shiftId: assignment.shiftId, reason: 'The shift was filled or removed.' });
      continue;
    }
    try {
      await reassignShift(ctx, { shiftId: assignment.shiftId, userId: assignment.userId });
      filled += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      skipped.push({ shiftId: assignment.shiftId, reason: error.message });
    }
  }
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_approve',
      entityType: 'roster',
      entityId: roster.id,
      context: { action: 'fill_vacant', filled, skipped: skipped.length },
    }),
  );
  return { filled, skipped };
}

export type InstantBuildResult = {
  added: number;
  filled: number;
  stillVacant: number;
  message: string;
  check: RosterCheck;
};

/**
 * Instant build, in the roster's Actions menu: no model and no preview, because the manager asked
 * for exactly this with a click and nothing reaches staff until they publish. On a roster with
 * vacant shifts, it fills them; on an empty one, it builds the business's usual week (the last
 * four weeks' pattern, else the trading hours) and fills it; otherwise there is nothing to do.
 */
export async function instantBuild(
  ctx: TenantContext,
  rosterId: string,
): Promise<InstantBuildResult> {
  requirePermission(ctx, 'rosters.manage');
  const roster = await getRoster(ctx, rosterId);
  if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
  if (roster.authorisedAt) {
    throw new AppError('CONFLICT', 'This roster has been authorised for pay and is locked.');
  }
  const shifts = await listRosterShifts(ctx, roster.id);
  let added = 0;
  let filled = 0;

  if (shifts.length === 0) {
    const contracted = await listContractedMinutes(ctx);
    const outcome = await planRoster(ctx, {
      startDate: roster.startsOn,
      endDate: roster.endsOn,
      strategy: 'even_hours',
      source: 'patterns',
      contractedFirst: Boolean(contracted && Object.keys(contracted).length),
    });
    if (outcome.kind === 'unavailable') throw new AppError('CONFLICT', outcome.message);
    const saved = await approveRosterPreview(ctx, {
      shifts: outcome.artifact.shifts.slice(0, 300).map((shift) => ({
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        userId: shift.userId,
        teamId: shift.teamId,
        breaks: shift.breaks,
        note: shift.note,
      })),
    });
    added = saved.saved;
  } else if (shifts.some((shift) => !shift.userId)) {
    const plan = await planVacantFill(ctx, roster.id);
    filled = (await applyVacantFill(ctx, { rosterId: roster.id, assignments: plan.assignments }))
      .filled;
  }

  const check = await checkRoster(ctx, roster.id);
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'update',
      entityType: 'roster',
      entityId: roster.id,
      context: { instantBuild: true, added, filled, stillVacant: check.vacant },
    }),
  );
  const message =
    added > 0
      ? `Instant build added ${plural(added, 'shift')}${check.vacant ? `; ${check.vacant} could not be filled` : ', all filled'}.`
      : filled > 0
        ? `Instant build filled ${plural(filled, 'vacant shift')}${check.vacant ? `; ${check.vacant} still need${check.vacant === 1 ? 's' : ''} someone` : ''}.`
        : shifts.length > 0 && check.vacant > 0
          ? `Nobody free could take the ${plural(check.vacant, 'vacant shift')}.`
          : 'Every shift already has someone on it.';
  return { added, filled, stillVacant: check.vacant, message, check };
}
