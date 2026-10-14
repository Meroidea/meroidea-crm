'use client';

import { Plus, Settings2, Star } from 'lucide-react';
import Link from 'next/link';
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
  makeDefaultPipelineAction,
  savePipelineAction,
  saveStageRulesAction,
  togglePipelineAction,
} from '@/modules/crm-config/actions';
import { OPPORTUNITY_FIELD_KEYS, OPPORTUNITY_FIELD_LABELS } from '@/modules/opportunities/fields';

type Option = { value: string; label: string };

export type PipelineRow = {
  id: string;
  name: string;
  leadType: 'b2b' | 'b2c' | null;
  isDefault: boolean;
  isActive: boolean;
};

export function PipelineList({
  pipelines,
  selectedId,
}: {
  pipelines: PipelineRow[];
  selectedId: string;
}) {
  const { run, error, isPending } = useActionRunner();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [leadType, setLeadType] = useState('');

  return (
    <div className={cn('flex flex-col gap-3', isPending && 'opacity-80')}>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {pipelines.map((pipeline) => (
          <li
            key={pipeline.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
          >
            {editing === pipeline.id ? (
              <form
                className="flex flex-1 flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(
                    () => savePipelineAction({ id: pipeline.id, name, leadType, description: '' }),
                    () => setEditing(null),
                  );
                }}
              >
                <Input
                  aria-label="Pipeline name"
                  className="h-8 w-48"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <NativeSelect
                  aria-label="Used for"
                  className="h-8 w-auto"
                  value={leadType}
                  onChange={(e) => setLeadType(e.target.value)}
                >
                  <option value="">Any lead</option>
                  <option value="b2b">B2B leads</option>
                  <option value="b2c">B2C leads</option>
                </NativeSelect>
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <Link
                  href={`/settings?tab=pipeline&pipeline=${pipeline.id}`}
                  className={cn(
                    'flex items-center gap-2 text-sm hover:text-primary',
                    pipeline.id === selectedId && 'font-semibold',
                    !pipeline.isActive && 'text-muted-foreground line-through',
                  )}
                >
                  {pipeline.name}
                  {pipeline.isDefault && <Badge variant="outline">Default</Badge>}
                  {pipeline.leadType && (
                    <Badge variant="outline">{pipeline.leadType.toUpperCase()} leads</Badge>
                  )}
                </Link>
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setName(pipeline.name);
                      setLeadType(pipeline.leadType ?? '');
                      setEditing(pipeline.id);
                    }}
                  >
                    Edit
                  </Button>
                  {!pipeline.isDefault && pipeline.isActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(() => makeDefaultPipelineAction({ id: pipeline.id }))}
                    >
                      <Star aria-hidden /> Make default
                    </Button>
                  )}
                  {!pipeline.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(() =>
                          togglePipelineAction({ id: pipeline.id, isActive: !pipeline.isActive }),
                        )
                      }
                    >
                      {pipeline.isActive ? 'Turn off' : 'Turn on'}
                    </Button>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => savePipelineAction({ name, leadType, description: '' }),
              () => {
                setAdding(false);
                setName('');
              },
            );
          }}
        >
          <Input
            aria-label="New pipeline name"
            placeholder="e.g. Rentals"
            className="w-56"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <NativeSelect
            aria-label="Used for"
            className="w-auto"
            value={leadType}
            onChange={(e) => setLeadType(e.target.value)}
          >
            <option value="">Any lead</option>
            <option value="b2b">B2B leads</option>
            <option value="b2c">B2C leads</option>
          </NativeSelect>
          <Button type="submit" disabled={!name.trim()}>
            Add
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => {
            setName('');
            setLeadType('');
            setAdding(true);
          }}
        >
          <Plus aria-hidden /> Add pipeline
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export type StageRuleRow = {
  id: string;
  name: string;
  category: 'open' | 'won' | 'lost';
  ownerUserId: string | null;
  ownerTeamId: string | null;
  onEnter: 'notify' | 'reassign' | 'task';
  requiredFields: string[];
  checklist: { id: string; label: string }[];
  requiresApproval: boolean;
};

function StageRulesSheet({
  stage,
  onClose,
  people,
  teams,
  customFields,
}: {
  stage: StageRuleRow;
  onClose: () => void;
  people: Option[];
  teams: Option[];
  customFields: { key: string; label: string }[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [owner, setOwner] = useState(
    stage.ownerUserId
      ? `user:${stage.ownerUserId}`
      : stage.ownerTeamId
        ? `team:${stage.ownerTeamId}`
        : '',
  );
  const [onEnter, setOnEnter] = useState(stage.onEnter);
  const [required, setRequired] = useState(stage.requiredFields);
  const [checklist, setChecklist] = useState(stage.checklist);
  const [approval, setApproval] = useState(stage.requiresApproval);
  const [item, setItem] = useState('');
  const fields = [
    ...OPPORTUNITY_FIELD_KEYS.map((key) => ({ ref: key, label: OPPORTUNITY_FIELD_LABELS[key] })),
    ...customFields.map((field) => ({ ref: `custom:${field.key}`, label: field.label })),
  ];

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{stage.name}: rules</SheetTitle>
          <SheetDescription>
            Who is responsible here, and what must be true to move on.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-4 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                saveStageRulesAction({
                  id: stage.id,
                  ownerUserId: owner.startsWith('user:') ? owner.slice(5) : '',
                  ownerTeamId: owner.startsWith('team:') ? owner.slice(5) : '',
                  onEnter,
                  requiredFields: required,
                  checklist,
                  requiresApproval: approval,
                }),
              onClose,
            );
          }}
        >
          <Field name="stage-owner" label="Stage owner">
            <NativeSelect id="stage-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Nobody in particular</option>
              <optgroup label="A person">
                {people.map((person) => (
                  <option key={person.value} value={`user:${person.value}`}>
                    {person.label}
                  </option>
                ))}
              </optgroup>
              {teams.length > 0 && (
                <optgroup label="A team, in turn">
                  {teams.map((team) => (
                    <option key={team.value} value={`team:${team.value}`}>
                      {team.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </Field>
          {owner && (
            <Field name="stage-enter" label="When an opportunity enters this stage">
              <NativeSelect
                id="stage-enter"
                value={onEnter}
                onChange={(e) => setOnEnter(e.target.value as StageRuleRow['onEnter'])}
              >
                <option value="notify">Tell the stage owner</option>
                <option value="reassign">Make the stage owner its owner</option>
                <option value="task">
                  Give the stage owner a task (e.g. a handover to delivery)
                </option>
              </NativeSelect>
            </Field>
          )}
          {stage.category !== 'lost' && (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium">Fields required to enter this stage</legend>
                {fields.map((field) => (
                  <label key={field.ref} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={required.includes(field.ref)}
                      onChange={(e) =>
                        setRequired(
                          e.target.checked
                            ? [...required, field.ref]
                            : required.filter((ref) => ref !== field.ref),
                        )
                      }
                    />
                    {field.label}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={approval}
                  onChange={(e) => setApproval(e.target.checked)}
                />
                <span>
                  Entering this stage needs a manager’s approval
                  <span className="block text-xs text-muted-foreground">
                    For discounts or contracts. People with the approve permission move it straight
                    away.
                  </span>
                </span>
              </label>
            </>
          )}
          {stage.category === 'open' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Checklist to finish before moving on</legend>
              {checklist.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{entry.label}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setChecklist(checklist.filter((c) => c.id !== entry.id))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  aria-label="New checklist item"
                  placeholder="e.g. Proposal sent"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!item.trim()}
                  onClick={() => {
                    setChecklist([
                      ...checklist,
                      { id: crypto.randomUUID().slice(0, 8), label: item.trim() },
                    ]);
                    setItem('');
                  }}
                >
                  Add
                </Button>
              </div>
            </fieldset>
          )}
          <ErrorNote error={error} />
          <SheetFooter className="mt-auto flex-row justify-end px-0">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save rules'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function StageRulesList({
  stages,
  people,
  teams,
  customFields,
}: {
  stages: StageRuleRow[];
  people: Option[];
  teams: Option[];
  customFields: { key: string; label: string }[];
}) {
  const [editing, setEditing] = useState<StageRuleRow | null>(null);
  const nameOf = (stage: StageRuleRow) =>
    stage.ownerUserId
      ? (people.find((person) => person.value === stage.ownerUserId)?.label ?? 'A former member')
      : stage.ownerTeamId
        ? `Team ${teams.find((team) => team.value === stage.ownerTeamId)?.label ?? ''}`
        : null;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {stages.map((stage) => {
          const owner = nameOf(stage);
          const notes = [
            owner && `Owner: ${owner}`,
            stage.requiredFields.length > 0 &&
              `${stage.requiredFields.length} required field${stage.requiredFields.length === 1 ? '' : 's'}`,
            stage.checklist.length > 0 && `${stage.checklist.length}-item checklist`,
            stage.requiresApproval && 'Needs approval',
          ].filter(Boolean);
          return (
            <li key={stage.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{stage.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {notes.join(' · ') || 'No rules'}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(stage)}>
                <Settings2 aria-hidden /> Rules
              </Button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <StageRulesSheet
          key={editing.id}
          stage={editing}
          onClose={() => setEditing(null)}
          people={people}
          teams={teams}
          customFields={customFields}
        />
      )}
    </div>
  );
}
