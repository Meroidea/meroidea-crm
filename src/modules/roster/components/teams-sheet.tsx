'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { deleteTeamAction, saveTeamAction } from '@/modules/roster/actions';
import { teamCode } from '@/modules/roster/hours';
import { TEAM_COLORS, type TeamColor } from '@/modules/roster/rules';
import type { RosterPerson, RosterTeam } from '@/modules/roster/types';

const COLOR_NAME: Record<TeamColor, string> = {
  'chart-1': 'Indigo',
  'chart-2': 'Sky',
  'chart-3': 'Blue',
  'chart-4': 'Violet',
  'chart-5': 'Coral',
};

type Draft = { id?: string; name: string; color: TeamColor; memberIds: string[] };

const blank = (teams: RosterTeam[]): Draft => ({
  name: '',
  // Start a new team on the colour used least, so teams stay easy to tell apart.
  color:
    [...TEAM_COLORS].sort(
      (a, b) =>
        teams.filter((team) => team.color === a).length -
        teams.filter((team) => team.color === b).length,
    )[0] ?? 'chart-3',
  memberIds: [],
});

/** The teams people are rostered into, and who belongs to each. */
export function TeamsSheet({
  teams,
  people,
  onClose,
}: {
  teams: RosterTeam[];
  people: RosterPerson[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(teams.length === 0 ? blank(teams) : null);
  const [error, setError] = useState<{ message: string; name?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const finish = (result: {
    ok: boolean;
    error?: { message: string; fieldErrors?: Record<string, string[]> };
  }) => {
    if (!result.ok) {
      setError({
        message: result.error?.message ?? 'Something went wrong.',
        name: result.error?.fieldErrors?.name?.[0],
      });
      return;
    }
    setError(null);
    setDraft(null);
    router.refresh();
  };
  const save = () =>
    startTransition(async () => {
      if (draft) finish(await saveTeamAction(draft));
    });
  const remove = () =>
    startTransition(async () => {
      if (draft?.id) finish(await deleteTeamAction({ id: draft.id }));
    });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{draft ? (draft.id ? 'Edit team' : 'New team') : 'Teams'}</SheetTitle>
          <SheetDescription>
            A team is an area, duty or level people are rostered into. Someone can only be given a
            shift in a team they belong to.
          </SheetDescription>
        </SheetHeader>

        {draft ? (
          <>
            <div className="flex flex-col gap-5 px-4">
              <Field name="team-name" label="Name" error={error?.name} required>
                <Input
                  maxLength={40}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  {...fieldA11y('team-name', error?.name)}
                />
              </Field>

              <fieldset>
                <legend className="text-sm font-medium">Colour</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TEAM_COLORS.map((color) => (
                    <label
                      key={color}
                      style={{ '--tone': `var(--${color})` } as CSSProperties}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
                        draft.color === color ? 'border-primary bg-accent' : 'hover:bg-muted',
                      )}
                    >
                      <input
                        type="radio"
                        name="team-color"
                        className="sr-only"
                        checked={draft.color === color}
                        onChange={() => setDraft({ ...draft, color })}
                      />
                      <span aria-hidden className="size-3.5 rounded-sm bg-[var(--tone)]" />
                      {COLOR_NAME[color]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium">
                  People in this team ({draft.memberIds.length})
                </legend>
                <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-lg border">
                  {people.map((person) => {
                    const on = draft.memberIds.includes(person.userId);
                    return (
                      <li key={person.userId}>
                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={on}
                            onChange={() =>
                              setDraft({
                                ...draft,
                                memberIds: on
                                  ? draft.memberIds.filter((userId) => userId !== person.userId)
                                  : [...draft.memberIds, person.userId],
                              })
                            }
                          />
                          <span className="truncate" data-sensitive>
                            {person.fullName}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              {error && (
                <p role="alert" className="text-sm text-destructive-text">
                  {error.message}
                </p>
              )}
            </div>
            <SheetFooter className="flex-row items-center">
              {draft.id && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive-text"
                  disabled={isPending}
                  onClick={remove}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="ml-auto"
                onClick={() => (teams.length === 0 ? onClose() : setDraft(null))}
              >
                {teams.length === 0 ? 'Close' : 'Back'}
              </Button>
              <Button type="button" disabled={isPending || !draft.name.trim()} onClick={save}>
                Save team
              </Button>
            </SheetFooter>
          </>
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <ul className="divide-y rounded-lg border">
              {teams.map((team) => (
                <li key={team.id}>
                  <button
                    type="button"
                    style={{ '--tone': `var(--${team.color})` } as CSSProperties}
                    onClick={() => {
                      setError(null);
                      setDraft({
                        id: team.id,
                        name: team.name,
                        color: team.color,
                        memberIds: team.memberIds,
                      });
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--tone)_30%,var(--card))] text-[11px] font-semibold"
                    >
                      {teamCode(team.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{team.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {team.memberIds.length} {team.memberIds.length === 1 ? 'person' : 'people'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => {
                setError(null);
                setDraft(blank(teams));
              }}
            >
              <Plus aria-hidden /> New team
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
