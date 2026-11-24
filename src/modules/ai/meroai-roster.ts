import 'server-only';

import { z } from 'zod';

import { addDaysToDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { formatCalendarDate } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { ROSTER_SPAN_DAYS } from '@/modules/roster/schemas';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { enforceLimits, readAttachment } from './agent';
import { planRoster } from './roster-planner';
import type { MeroAIRosterInput } from './schemas';
import { weekdayOf } from './roster-solver';
import { DATA_RULE, dataBlock } from './tools/shared';
import type { RosterPreviewArtifact, RosterStrategy } from './types';

/** Who goes on first, when the manager's notes say (ADR-079): "keep wages low", "best people". */
export const NOTE_PRIORITIES = ['lowest_cost', 'most_productive', 'even_hours'] as const;
type NotePriority = (typeof NOTE_PRIORITIES)[number];

const instructionsSchema = z.object({
  unavailable: z
    .array(
      z.object({ person: z.string().trim().min(1).max(120), dates: z.array(z.iso.date()).max(14) }),
    )
    .max(50),
  onlyPeople: z.array(z.string().trim().min(1).max(120)).max(100),
  priority: z
    .enum([...NOTE_PRIORITIES, 'none'])
    .catch('none')
    .transform((value) => (value === 'none' ? null : value)),
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
    priority: {
      type: 'string',
      enum: [...NOTE_PRIORITIES, 'none'],
      description:
        'lowest_cost when the notes ask to keep wages or cost down (e.g. "minimum wages", "cheapest staff"); most_productive when they ask for the best, most reliable or experienced people; even_hours when they ask to share hours fairly; otherwise none.',
    },
  },
  required: ['unavailable', 'onlyPeople', 'priority'],
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

const PRIORITY_WORDS: Record<NotePriority, string> = {
  lowest_cost: 'Put the lowest-cost people on first',
  most_productive: 'Put your most reliable people on first',
  even_hours: 'Shared the hours out evenly',
};

export type RosterNotes = {
  unavailable: { userId: string; date: string }[];
  onlyUserIds: string[] | undefined;
  priority: NotePriority | null;
  warnings: string[];
  /** What MeroAI took from the notes, in words, for the manager to check. */
  applied: string[];
  read: boolean;
};

/**
 * Reads a manager's notes (and a file they attach, such as an availability sheet) into who cannot
 * work when, who alone should be rostered, and who should go on first. Only the fast model reads
 * them; names are matched to the team here, and anything unmatched is reported rather than
 * guessed. Nothing the notes say can change a rule the solver keeps.
 */
export async function readRosterNotes(
  ctx: TenantContext,
  input: { startsOn: string; days: number; instructions?: string; file?: File },
): Promise<RosterNotes> {
  const none: RosterNotes = {
    unavailable: [],
    onlyUserIds: undefined,
    priority: null,
    warnings: [],
    applied: [],
    read: false,
  };
  if (!input.instructions && !input.file) return none;
  if (!aiService.isConfigured()) {
    throw new AppError(
      'INTERNAL',
      'MeroAI cannot read notes or files until a Gemini API key is set up.',
    );
  }
  const attachment = input.file ? await readAttachment(input.file) : null;
  const members = await listActiveMembers(ctx);
  const days = Array.from({ length: input.days }, (_, index) => {
    const date = addDaysToDate(input.startsOn, index);
    return { date, weekday: weekdayOf(date) };
  });
  const parsed = await aiService.generateJson('fast', {
    systemInstruction: [
      'You read a manager’s notes about a staff roster, and any file they attach (such as an availability list), and list who cannot work on which days, whether only certain people should be rostered, and who should go on first.',
      'Use only the roster days given. "Friday" means the Friday in those days. Leave lists empty and priority none when the notes say nothing about them.',
      DATA_RULE,
    ].join('\n'),
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              dataBlock('roster_days', days),
              `Notes: ${input.instructions ?? '(none; read the attached file)'}`,
            ].join('\n\n'),
          },
          ...(attachment
            ? [
                {
                  inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.bytes.toString('base64'),
                  },
                },
              ]
            : []),
        ],
      },
    ],
    jsonSchema: instructionsJsonSchema,
    schema: instructionsSchema,
  });

  const notes: RosterNotes = { ...none, read: true, priority: parsed.priority };
  const inRoster = new Set(days.map((day) => day.date));
  const unknown = new Set<string>();
  for (const item of parsed.unavailable) {
    const person = findPerson(members, item.person);
    if (!person) {
      unknown.add(item.person);
      continue;
    }
    const kept = item.dates.filter((date) => inRoster.has(date));
    for (const date of kept) notes.unavailable.push({ userId: person.userId, date });
    if (kept.length) {
      notes.applied.push(
        `Kept ${person.fullName} off ${kept.map((date) => formatCalendarDate(date)).join(', ')}`,
      );
    }
  }
  if (parsed.onlyPeople.length) {
    const matched = parsed.onlyPeople.map((name) => ({ name, person: findPerson(members, name) }));
    for (const item of matched) if (!item.person) unknown.add(item.name);
    const found = matched.flatMap((item) => (item.person ? [item.person] : []));
    if (found.length) {
      notes.onlyUserIds = found.map((person) => person.userId);
      notes.applied.push(`Rostered only ${found.map((person) => person.fullName).join(', ')}`);
    }
  }
  if (unknown.size) {
    notes.warnings.push(
      `MeroAI could not match ${[...unknown].map((name) => `“${name}”`).join(', ')} to one person in your team, so ignored ${unknown.size === 1 ? 'it' : 'them'}.`,
    );
  }
  notes.unavailable = notes.unavailable.filter(
    (item, index) =>
      notes.unavailable.findIndex(
        (other) => other.userId === item.userId && other.date === item.date,
      ) === index,
  );
  if (parsed.priority) notes.applied.push(PRIORITY_WORDS[parsed.priority]);
  if (!notes.applied.length && !notes.warnings.length) {
    notes.warnings.push(
      'MeroAI found nothing in your notes it could act on: it understands who cannot work when, who alone to roster, and who should go on first.',
    );
  }
  return notes;
}

/**
 * "Ask MeroAI" on the roster page (ADR-076). The way of working is chosen with a click and
 * planned in code: instant, free and the same every time. Only words the manager adds ("Sam is
 * off Friday") go to the fast model (readRosterNotes). Nothing is saved: the preview is approved
 * through approveRosterPreview like any other.
 */
export async function buildRosterWithMeroAI(
  ctx: TenantContext,
  input: MeroAIRosterInput,
): Promise<{ reply: string; artifact: RosterPreviewArtifact }> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'rosters.manage');
  await enforceLimits(ctx);

  const days = ROSTER_SPAN_DAYS[input.span];
  const endDate = addDaysToDate(input.startsOn, days - 1);
  const notes = await readRosterNotes(ctx, {
    startsOn: input.startsOn,
    days,
    instructions: input.instructions,
  });
  const strategy: RosterStrategy = input.strategy;

  const outcome = await planRoster(ctx, {
    startDate: input.startsOn,
    endDate,
    strategy,
    onlyUserIds: notes.onlyUserIds,
    unavailable: notes.unavailable,
    extraWarnings: notes.warnings,
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
        instructionsRead: notes.read,
        model: notes.read ? aiService.modelFor('fast') : null,
        unavailableDays: notes.unavailable.length,
      },
    }),
  );
  return {
    reply: outcome.reply,
    artifact: { ...outcome.artifact, notesApplied: notes.applied },
  };
}
