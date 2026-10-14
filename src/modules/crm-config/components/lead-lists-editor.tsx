'use client';

import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { stageColorVar } from '@/lib/stage-color';
import { cn } from '@/lib/utils';
import {
  addLeadReasonAction,
  addSubSourceAction,
  moveLeadStatusAction,
  renameSourceAction,
  renameSubSourceAction,
  saveLeadStatusAction,
  toggleLeadReasonAction,
  toggleLeadStatusAction,
  toggleSubSourceAction,
} from '@/modules/crm-config/actions';
import { STATUS_COLORS } from '@/modules/crm-config/schemas';
import { addLeadSourceAction, toggleLeadSourceAction } from '@/modules/settings/actions';

/** Inline rename: shows the name with a pencil, or a small form while editing. */
function Renamable({
  name,
  inactive,
  onSave,
}: {
  name: string;
  inactive?: boolean;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn('truncate text-sm', inactive && 'text-muted-foreground line-through')}>
          {name}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Rename ${name}`}
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden />
        </Button>
      </span>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-1 gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && value.trim() !== name) onSave(value.trim());
        setEditing(false);
      }}
    >
      <Input
        aria-label="New name"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        className="h-8"
      />
      <Button type="submit" size="sm">
        Save
      </Button>
    </form>
  );
}

export type SourceRow = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  subSources: { id: string; name: string; isActive: boolean }[];
};

export function SourcesEditor({ sources }: { sources: SourceRow[] }) {
  const { run, error, isPending } = useActionRunner();
  const [newSource, setNewSource] = useState('');
  const [newSub, setNewSub] = useState<Record<string, string>>({});

  return (
    <div className={cn('flex max-w-3xl flex-col gap-4', isPending && 'opacity-80')}>
      <ul className="flex flex-col gap-3">
        {sources.map((source) => (
          <li key={source.id} className="rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
              <Renamable
                name={source.name}
                inactive={!source.isActive}
                onSave={(name) => run(() => renameSourceAction({ id: source.id, name }))}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  run(() => toggleLeadSourceAction({ id: source.id, isActive: !source.isActive }))
                }
              >
                {source.isActive ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex flex-col gap-1 px-4 py-2">
              {source.subSources.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No sub-sources: leads from here need only the source.
                </p>
              )}
              {source.subSources.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between gap-2 pl-3">
                  <Renamable
                    name={sub.name}
                    inactive={!sub.isActive}
                    onSave={(name) => run(() => renameSubSourceAction({ id: sub.id, name }))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() => toggleSubSourceAction({ id: sub.id, isActive: !sub.isActive }))
                    }
                  >
                    {sub.isActive ? 'Turn off' : 'Turn on'}
                  </Button>
                </div>
              ))}
              <form
                className="mt-1 flex gap-2 pl-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = (newSub[source.id] ?? '').trim();
                  if (name)
                    run(
                      () => addSubSourceAction({ sourceId: source.id, name }),
                      () => setNewSub((current) => ({ ...current, [source.id]: '' })),
                    );
                }}
              >
                <Input
                  aria-label={`New sub-source of ${source.name}`}
                  placeholder="Add a sub-source"
                  className="h-8"
                  value={newSub[source.id] ?? ''}
                  onChange={(event) =>
                    setNewSub((current) => ({ ...current, [source.id]: event.target.value }))
                  }
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!(newSub[source.id] ?? '').trim()}
                >
                  <Plus aria-hidden /> Add
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (newSource.trim())
            run(
              () => addLeadSourceAction({ name: newSource }),
              () => setNewSource(''),
            );
        }}
      >
        <Input
          aria-label="New source"
          placeholder="New source, e.g. Trade show"
          value={newSource}
          onChange={(event) => setNewSource(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!newSource.trim()}>
          <Plus aria-hidden /> Add source
        </Button>
      </form>
      <ErrorNote error={error} />
    </div>
  );
}

export type StatusRow = {
  id: string;
  name: string;
  kind: string;
  leadType: 'b2b' | 'b2c' | null;
  requiresReason: boolean;
  isSystem: boolean;
  color: string | null;
  isActive: boolean;
};

const KIND_LABELS: Record<string, string> = {
  new: 'New',
  working: 'Working',
  pending_acceptance: 'Awaiting acceptance',
  returned: 'Returned',
  converted: 'Converted',
  closed: 'Closed',
};

function StatusEdit({ status, onDone }: { status?: StatusRow; onDone: () => void }) {
  const { run, error, isPending } = useActionRunner();
  const [name, setName] = useState(status?.name ?? '');
  const [kind, setKind] = useState<'working' | 'closed'>('working');
  const [leadType, setLeadType] = useState<string>(status?.leadType ?? '');
  const [color, setColor] = useState(status?.color ?? 'chart-3');
  const [requiresReason, setRequiresReason] = useState(status?.requiresReason ?? false);
  const isClosed = status ? status.kind === 'closed' : kind === 'closed';
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveLeadStatusAction({
              id: status?.id,
              name,
              kind: status ? undefined : kind,
              leadType,
              color: color as (typeof STATUS_COLORS)[number],
              requiresReason,
            }),
          onDone,
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-4">
        <Input
          aria-label="Status name"
          placeholder="Status name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {!status && (
          <NativeSelect
            aria-label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'working' | 'closed')}
          >
            <option value="working">Working (still being qualified)</option>
            <option value="closed">Closed (ends qualification)</option>
          </NativeSelect>
        )}
        <NativeSelect
          aria-label="Workflow"
          value={leadType}
          disabled={status?.isSystem}
          onChange={(e) => setLeadType(e.target.value)}
        >
          <option value="">B2B and B2C</option>
          <option value="b2b">B2B only</option>
          <option value="b2c">B2C only</option>
        </NativeSelect>
        <NativeSelect aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)}>
          {STATUS_COLORS.map((value) => (
            <option key={value} value={value}>
              {value.replace('chart-', 'Colour ')}
            </option>
          ))}
        </NativeSelect>
      </div>
      {isClosed && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={requiresReason}
            onChange={(e) => setRequiresReason(e.target.checked)}
          />
          Ask for a reason
        </label>
      )}
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function StatusesEditor({ statuses }: { statuses: StatusRow[] }) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {statuses.map((status, index) => (
          <li key={status.id} className="flex flex-col gap-2 px-4 py-2.5">
            {editing === status.id ? (
              <StatusEdit status={status} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: stageColorVar(status.color) }}
                  />
                  <span
                    className={cn(
                      'text-sm font-medium',
                      !status.isActive && 'text-muted-foreground line-through',
                    )}
                  >
                    {status.name}
                  </span>
                  <Badge variant="outline">{KIND_LABELS[status.kind] ?? status.kind}</Badge>
                  {status.leadType && (
                    <Badge variant="outline">{status.leadType.toUpperCase()}</Badge>
                  )}
                  {status.requiresReason && (
                    <span className="text-xs text-muted-foreground">reason asked</span>
                  )}
                  {status.isSystem && (
                    <span className="text-xs text-muted-foreground">used by the workflow</span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() =>
                      run(() => moveLeadStatusAction({ id: status.id, direction: 'up' }))
                    }
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === statuses.length - 1}
                    onClick={() =>
                      run(() => moveLeadStatusAction({ id: status.id, direction: 'down' }))
                    }
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(status.id)}>
                    Edit
                  </Button>
                  {!status.isSystem && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(() =>
                          toggleLeadStatusAction({ id: status.id, isActive: !status.isActive }),
                        )
                      }
                    >
                      {status.isActive ? 'Turn off' : 'Turn on'}
                    </Button>
                  )}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <StatusEdit onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add status
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function ReasonsEditor({
  kind,
  reasons,
  placeholder,
}: {
  kind: 'disqualify' | 'reject';
  reasons: { id: string; name: string; isActive: boolean }[];
  placeholder: string;
}) {
  const { run, error, isPending } = useActionRunner();
  const [name, setName] = useState('');
  return (
    <div className={cn('flex max-w-xl flex-col gap-3', isPending && 'opacity-80')}>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {reasons.map((reason) => (
          <li key={reason.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span
              className={cn('text-sm', !reason.isActive && 'text-muted-foreground line-through')}
            >
              {reason.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                run(() => toggleLeadReasonAction({ id: reason.id, isActive: !reason.isActive }))
              }
            >
              {reason.isActive ? 'Turn off' : 'Turn on'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim())
            run(
              () => addLeadReasonAction({ kind, name }),
              () => setName(''),
            );
        }}
      >
        <Input
          aria-label={placeholder}
          placeholder={placeholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!name.trim()}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
      <ErrorNote error={error} />
    </div>
  );
}
