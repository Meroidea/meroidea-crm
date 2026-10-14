'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
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
import {
  deleteRoutingRuleAction,
  moveRoutingRuleAction,
  saveRoutingRuleAction,
} from '@/modules/crm-config/actions';

type Option = { value: string; label: string };

export type RuleRow = {
  id: string;
  name: string;
  stage: 'intake' | 'handover';
  leadType: 'b2b' | 'b2c' | null;
  method: 'round_robin' | 'least_loaded';
  userIds: string[];
  teamId: string | null;
  conditions: Partial<Record<string, string[]>>;
  isActive: boolean;
};

const TEXT_CONDITIONS = [
  ['countries', 'Countries', 'AU, NZ'],
  ['regions', 'States or regions', 'NSW, VIC'],
  ['industries', 'Industries', 'Hospitality, Retail'],
  ['companySizes', 'Company sizes', '1–10, 11–50'],
  ['languages', 'Languages', 'English, Nepali'],
  ['interests', 'Interested in', 'Visa, Study'],
] as const;

const split = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

function MultiCheck({
  options,
  value,
  onChange,
  label,
}: {
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.value]
                    : value.filter((id) => id !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RuleSheet({
  rule,
  open,
  onClose,
  people,
  teams,
  sources,
  subSources,
}: {
  rule: RuleRow | null;
  open: boolean;
  onClose: () => void;
  people: Option[];
  teams: Option[];
  sources: Option[];
  subSources: Option[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [values, setValues] = useState(() => ({
    name: rule?.name ?? '',
    stage: rule?.stage ?? 'intake',
    leadType: rule?.leadType ?? '',
    method: rule?.method ?? 'round_robin',
    userIds: rule?.userIds ?? [],
    teamId: rule?.teamId ?? '',
    isActive: rule?.isActive ?? true,
    sourceIds: rule?.conditions.sourceIds ?? [],
    subSourceIds: rule?.conditions.subSourceIds ?? [],
    text: Object.fromEntries(
      TEXT_CONDITIONS.map(([key]) => [key, (rule?.conditions[key] ?? []).join(', ')]),
    ) as Record<string, string>,
  }));
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{rule ? 'Edit routing rule' : 'New routing rule'}</SheetTitle>
          <SheetDescription>
            Leave a condition empty to match anything. Rules are tried in order; the first match
            picks the person.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-4 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                saveRoutingRuleAction({
                  id: rule?.id,
                  name: values.name,
                  stage: values.stage,
                  leadType: values.leadType,
                  method: values.method,
                  userIds: values.userIds,
                  teamId: values.teamId,
                  isActive: values.isActive,
                  conditions: {
                    sourceIds: values.sourceIds,
                    subSourceIds: values.subSourceIds,
                    ...Object.fromEntries(
                      TEXT_CONDITIONS.map(([key]) => [key, split(values.text[key] ?? '')]),
                    ),
                  },
                }),
              onClose,
            );
          }}
        >
          <Field name="rule-name" label="Name" required>
            <Input
              id="rule-name"
              value={values.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field name="rule-stage" label="Applies to">
              <NativeSelect
                id="rule-stage"
                value={values.stage}
                onChange={(e) => set({ stage: e.target.value as 'intake' | 'handover' })}
              >
                <option value="intake">New leads</option>
                <option value="handover">Handovers to sales reps</option>
              </NativeSelect>
            </Field>
            <Field name="rule-type" label="Workflow">
              <NativeSelect
                id="rule-type"
                value={values.leadType}
                onChange={(e) => set({ leadType: e.target.value as '' | 'b2b' | 'b2c' })}
              >
                <option value="">B2B and B2C</option>
                <option value="b2b">B2B only</option>
                <option value="b2c">B2C only</option>
              </NativeSelect>
            </Field>
          </div>
          <Field name="rule-method" label="Share out">
            <NativeSelect
              id="rule-method"
              value={values.method}
              onChange={(e) => set({ method: e.target.value as 'round_robin' | 'least_loaded' })}
            >
              <option value="round_robin">In turn (round-robin)</option>
              <option value="least_loaded">To whoever has the fewest open</option>
            </NativeSelect>
          </Field>
          <MultiCheck
            label="Between these people"
            options={people}
            value={values.userIds}
            onChange={(userIds) => set({ userIds })}
          />
          <Field name="rule-team" label="Or everyone in a team">
            <NativeSelect
              id="rule-team"
              value={values.teamId}
              onChange={(e) => set({ teamId: e.target.value })}
            >
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.value} value={team.value}>
                  {team.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <h3 className="pt-2 text-sm font-semibold">When the lead matches</h3>
          <MultiCheck
            label="Sources"
            options={sources}
            value={values.sourceIds}
            onChange={(sourceIds) => set({ sourceIds })}
          />
          <MultiCheck
            label="Sub-sources"
            options={subSources}
            value={values.subSourceIds}
            onChange={(subSourceIds) => set({ subSourceIds })}
          />
          {TEXT_CONDITIONS.map(([key, label, example]) => (
            <Field
              key={key}
              name={`rule-${key}`}
              label={label}
              hint={`Comma-separated, e.g. ${example}`}
            >
              <Input
                id={`rule-${key}`}
                value={values.text[key] ?? ''}
                onChange={(e) => set({ text: { ...values.text, [key]: e.target.value } })}
              />
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={values.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
            />
            Rule is on
          </label>
          <ErrorNote error={error} />
          <SheetFooter className="mt-auto flex-row justify-end px-0">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save rule'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function RoutingEditor({
  rules,
  people,
  teams,
  sources,
  subSources,
}: {
  rules: RuleRow[];
  people: Option[];
  teams: Option[];
  sources: Option[];
  subSources: Option[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<RuleRow | 'new' | null>(null);
  const nameOf = (id: string) =>
    people.find((person) => person.value === id)?.label ?? 'Former member';

  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      {rules.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No rules yet. New leads stay with whoever adds them, or wait in the unassigned queue.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rules.map((rule, index) => (
          <li
            key={rule.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-xl border bg-card px-4 py-3"
          >
            <div className="min-w-0 space-y-1">
              <p
                className={cn(
                  'flex flex-wrap items-center gap-2 text-sm font-medium',
                  !rule.isActive && 'text-muted-foreground line-through',
                )}
              >
                {index + 1}. {rule.name}
                <Badge variant="outline">
                  {rule.stage === 'intake' ? 'New leads' : 'Handovers'}
                </Badge>
                {rule.leadType && <Badge variant="outline">{rule.leadType.toUpperCase()}</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {rule.method === 'round_robin' ? 'In turn between ' : 'Fewest open among '}
                {[
                  ...rule.userIds.map(nameOf),
                  ...(rule.teamId
                    ? [`team ${teams.find((team) => team.value === rule.teamId)?.label ?? ''}`]
                    : []),
                ].join(', ') || 'nobody'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => run(() => moveRoutingRuleAction({ id: rule.id, direction: 'up' }))}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Move down"
                disabled={index === rules.length - 1}
                onClick={() => run(() => moveRoutingRuleAction({ id: rule.id, direction: 'down' }))}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>
                Edit
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${rule.name}`}
                onClick={() => run(() => deleteRoutingRuleAction({ id: rule.id }))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
        <Plus aria-hidden /> Add rule
      </Button>
      <ErrorNote error={error} />
      {editing && (
        <RuleSheet
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          open
          onClose={() => setEditing(null)}
          people={people}
          teams={teams}
          sources={sources}
          subSources={subSources}
        />
      )}
    </div>
  );
}
