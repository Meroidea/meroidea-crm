import 'server-only';

import { AppError } from '@/lib/errors';
import { formatCalendarDate } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { getRoster, listRosterShifts, listRosterTeams } from '@/modules/roster/queries';
import type { TenantContext } from '@/server/context';

import type { DeleteRosterArtifact, RemoveShiftsArtifact } from './types';

/**
 * Proposals to take shifts off a roster, or the roster itself, shared by the roster agent's chat
 * and the MeroAI drawer (ADR-079). A proposal only lists what would go; the manager confirms it,
 * and the roster service removes it with every rule checked again.
 */

export type LoadedRoster = Awaited<ReturnType<typeof loadRosterForProposal>>;

export async function loadRosterForProposal(ctx: TenantContext, rosterId: string) {
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

/** A name as written: one clear match in the team, or a problem to ask about (never a guess). */
export function personNamed(loaded: LoadedRoster, name: string) {
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

export type RemoveWhich = 'all' | 'vacant' | 'person' | 'day' | 'team';

type Proposal<A> =
  | { ok: true; artifact: A; reply: string }
  | { ok: false; message: string; extra?: Record<string, unknown> };

const plural = (count: number) => `shift${count === 1 ? '' : 's'}`;

/** Which shifts would go: all of them, the vacant ones, one person's, one day's or one team's. */
export function proposeRemoveShifts(
  loaded: LoadedRoster,
  args: { which: RemoveWhich; personName?: string; date?: string; teamName?: string },
): Proposal<RemoveShiftsArtifact> {
  if (loaded.roster.authorisedAt) {
    return { ok: false, message: 'This roster has been authorised for pay and is locked.' };
  }
  let chosen = loaded.shifts;
  let description = `All ${loaded.shifts.length} ${plural(loaded.shifts.length)}`;
  if (args.which === 'vacant') {
    chosen = loaded.shifts.filter((shift) => !shift.userId);
    description = `The ${chosen.length} vacant ${plural(chosen.length)}`;
  } else if (args.which === 'person') {
    if (!args.personName) return { ok: false, message: 'Whose shifts?' };
    const found = personNamed(loaded, args.personName);
    if (!found.person) return { ok: false, message: found.problem };
    chosen = loaded.shifts.filter((shift) => shift.userId === found.person.userId);
    description = `${found.person.fullName}’s ${chosen.length} ${plural(chosen.length)}`;
  } else if (args.which === 'day') {
    if (!args.date) return { ok: false, message: 'Which day?' };
    chosen = loaded.shifts.filter((shift) => shift.date === args.date);
    description = `The ${chosen.length} ${plural(chosen.length)} on ${formatCalendarDate(args.date)}`;
  } else if (args.which === 'team') {
    const team = loaded.teams.find(
      (item) => item.name.toLowerCase() === (args.teamName ?? '').trim().toLowerCase(),
    );
    if (!team) {
      return {
        ok: false,
        message: `There is no team called "${args.teamName ?? ''}".`,
        extra: { teams: loaded.teams.map((item) => item.name) },
      };
    }
    chosen = loaded.shifts.filter((shift) => shift.teamId === team.id);
    description = `The ${chosen.length} ${team.name} ${plural(chosen.length)}`;
  }
  if (chosen.length === 0) {
    return { ok: false, message: 'No shifts on this roster match that.' };
  }
  const nameOf = new Map(loaded.members.map((member) => [member.userId, member.fullName]));
  return {
    ok: true,
    reply: `${description} on the roster for ${formatCalendarDate(loaded.roster.startsOn)} to ${formatCalendarDate(loaded.roster.endsOn)} will be removed when you confirm. Staff who were shown them are told when you next publish.`,
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
}

/** The whole roster and its shifts, for the manager to confirm deleting. */
export function proposeDeleteRoster(loaded: LoadedRoster): Proposal<DeleteRosterArtifact> {
  if (loaded.roster.authorisedAt) {
    return { ok: false, message: 'This roster has been authorised for pay and cannot be deleted.' };
  }
  const { roster, shifts } = loaded;
  return {
    ok: true,
    reply: `The roster for ${formatCalendarDate(roster.startsOn)} to ${formatCalendarDate(roster.endsOn)} and its ${shifts.length} ${plural(shifts.length)} will be deleted for everyone when you confirm.`,
    artifact: {
      kind: 'delete_roster',
      rosterId: roster.id,
      startsOn: roster.startsOn,
      endsOn: roster.endsOn,
      shifts: shifts.length,
      published: roster.status === 'published',
    },
  };
}
