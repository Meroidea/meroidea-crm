import 'server-only';

import { z } from 'zod';

import { addDaysToDate } from '@/lib/dates';
import { listActiveMembers } from '@/modules/members/queries';
import { ROSTER_SPAN_DAYS } from '@/modules/roster/schemas';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { enforceLimits } from './agent';
import { planRoster } from './roster-planner';
import type { MeroAIRosterInput } from './schemas';
import { weekdayOf } from './roster-solver';
import { DATA_RULE, dataBlock } from './tools/shared';
import type { RosterPreviewArtifact } from './types';
import { AppError } from '@/lib/errors';

const instructionsSchema = z.object({
  unavailable: z
    .array(
      z.object({ person: z.string().trim().min(1).max(120), dates: z.array(z.iso.date()).max(14) }),
    )
    .max(50),
  onlyPeople: z.array(z.string().trim().min(1).max(120)).max(100),
});

const instructionsJsonSchema = {
  type: 'object',
  properties: {
    unavailable: {
      type: 'array',
      description: 'People who cannot work on particular days of the roster.',
      items: {
        type: 'object',
        properties: {
          person: { type: 'string', description: 'Their name as written.' },
          dates: {
            type: 'array',
            items: { type: 'string' },
            description: 'YYYY-MM-DD, from the roster days.',
          },
        },
        required: ['person', 'dates'],
      },
    },
    onlyPeople: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only these people should be rostered, when the manager says so; else empty.',
    },
  },
  required: ['unavailable', 'onlyPeople'],
};

/** A name as written against the team: one clear match, or none (never a guess between two). */
function findPerson(members: { userId: string; fullName: string }[], name: string) {
  const wanted = name.toLowerCase();
  const exact = members.filter((member) => member.fullName.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]!;
  const partial = members.filter(
    (member) =>
      member.fullName
        .toLowerCase()
        .split(/\s+/)
        .some((part) => part === wanted) || member.fullName.toLowerCase().includes(wanted),
  );
  return partial.length === 1 ? partial[0]! : null;
}

/**
 * "Ask MeroAI" on the roster page (ADR-076). The way of working is chosen with a click and
 * planned in code: instant, free and the same every time. Only words the manager adds ("Sam is
 * off Friday") go to the fast model, which turns them into who cannot work when; names are then
 * matched to the team here, and anything unmatched is reported back rather than guessed.
 * Nothing is saved: the preview is approved through approveRosterPreview like any other.
 */
export async function buildRosterWithMeroAI(
  ctx: TenantContext,
  input: MeroAIRosterInput,
): Promise<{ reply: string; artifact: RosterPreviewArtifact }> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'rosters.manage');
  await enforceLimits(ctx);

  const endDate = addDaysToDate(input.startsOn, ROSTER_SPAN_DAYS[input.span] - 1);
  const extraWarnings: string[] = [];
  let unavailable: { userId: string; date: string }[] = [];
  let onlyUserIds: string[] | undefined;
  let readInstructions = false;

  if (input.instructions) {
    if (!aiService.isConfigured()) {
      throw new AppError(
        'INTERNAL',
        'MeroAI cannot read extra instructions until a Gemini API key is set up.',
      );
    }
    const members = await listActiveMembers(ctx);
    const days = Array.from({ length: ROSTER_SPAN_DAYS[input.span] }, (_, index) => {
      const date = addDaysToDate(input.startsOn, index);
      return { date, weekday: weekdayOf(date) };
    });
    const parsed = await aiService.generateJson('fast', {
      systemInstruction: [
        'You read a manager’s notes about a staff roster and list who cannot work on which days, and whether only certain people should be rostered.',
        'Use only the roster days given. "Friday" means the Friday in those days. Leave lists empty when the notes say nothing about them.',
        DATA_RULE,
      ].join('\n'),
      contents: [
        {
          role: 'user',
          parts: [
            { text: [dataBlock('roster_days', days), `Notes: ${input.instructions}`].join('\n\n') },
          ],
        },
      ],
      jsonSchema: instructionsJsonSchema,
      schema: instructionsSchema,
    });
    readInstructions = true;
    const inRoster = new Set(days.map((day) => day.date));
    const unknown = new Set<string>();
    for (const item of parsed.unavailable) {
      const person = findPerson(members, item.person);
      if (!person) {
        unknown.add(item.person);
        continue;
      }
      for (const date of item.dates)
        if (inRoster.has(date)) unavailable.push({ userId: person.userId, date });
    }
    if (parsed.onlyPeople.length) {
      const matched = parsed.onlyPeople.map((name) => ({
        name,
        person: findPerson(members, name),
      }));
      for (const item of matched) if (!item.person) unknown.add(item.name);
      const ids = matched.flatMap((item) => (item.person ? [item.person.userId] : []));
      if (ids.length) onlyUserIds = ids;
    }
    if (unknown.size) {
      extraWarnings.push(
        `MeroAI could not match ${[...unknown].map((name) => `“${name}”`).join(', ')} to one person in your team, so ignored ${unknown.size === 1 ? 'it' : 'them'}.`,
      );
    }
    unavailable = unavailable.filter(
      (item, index) =>
        unavailable.findIndex(
          (other) => other.userId === item.userId && other.date === item.date,
        ) === index,
    );
  }

  const outcome = await planRoster(ctx, {
    startDate: input.startsOn,
    endDate,
    strategy: input.strategy,
    onlyUserIds,
    unavailable,
    extraWarnings,
  });
  if (outcome.kind === 'unavailable') throw new AppError('CONFLICT', outcome.message);

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      context: {
        surface: 'roster',
        ...outcome.audit,
        // Whether a model read the manager's notes; the notes themselves are never kept.
        instructionsRead: readInstructions,
        model: readInstructions ? aiService.modelFor('fast') : null,
        unavailableDays: unavailable.length,
      },
    }),
  );
  return { reply: outcome.reply, artifact: outcome.artifact };
}
