'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  saveEmailTemplateAction,
  saveSequenceAction,
  toggleEmailTemplateAction,
  toggleSequenceAction,
} from '@/modules/crm-config/actions';
import { SEQUENCE_STEP_TYPES } from '@/modules/crm-config/schemas';

export const MERGE_FIELDS = [
  '{{contact.first_name}}',
  '{{contact.last_name}}',
  '{{contact.company}}',
  '{{user.name}}',
  '{{business.name}}',
];

type Template = { id: string; name: string; subject: string; body: string; isActive: boolean };

function TemplateEdit({ template, onDone }: { template?: Template; onDone: () => void }) {
  const { run, error, isPending } = useActionRunner();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => saveEmailTemplateAction({ id: template?.id, name, subject, body }), onDone);
      }}
    >
      <Field name="tpl-name" label="Template name" required>
        <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field name="tpl-subject" label="Subject" required>
        <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field
        name="tpl-body"
        label="Message"
        required
        hint={`Merge fields: ${MERGE_FIELDS.join(' ')}`}
      >
        <Textarea id="tpl-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          Save template
        </Button>
      </div>
    </form>
  );
}

export function TemplatesEditor({ templates }: { templates: Template[] }) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      {templates.length === 0 && editing !== 'new' && (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {templates.map((template) => (
          <li key={template.id} className="rounded-xl border bg-card px-4 py-2.5">
            {editing === template.id ? (
              <TemplateEdit template={template} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      !template.isActive && 'text-muted-foreground line-through',
                    )}
                  >
                    {template.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {template.subject}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(template.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() =>
                        toggleEmailTemplateAction({
                          id: template.id,
                          isActive: !template.isActive,
                        }),
                      )
                    }
                  >
                    {template.isActive ? 'Turn off' : 'Turn on'}
                  </Button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <TemplateEdit onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add template
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

const STEP_LABELS: Record<(typeof SEQUENCE_STEP_TYPES)[number], string> = {
  email: 'Email',
  call: 'Call',
  meeting: 'Meeting',
  follow_up: 'Follow-up',
  other: 'Other (e.g. LinkedIn)',
};

type Step = {
  id: string;
  day: number;
  type: (typeof SEQUENCE_STEP_TYPES)[number];
  title: string;
  templateId: string | null;
};
type Sequence = {
  id: string;
  name: string;
  description: string | null;
  steps: Step[];
  isActive: boolean;
};

function SequenceEdit({
  sequence,
  templates,
  onDone,
}: {
  sequence?: Sequence;
  templates: { value: string; label: string }[];
  onDone: () => void;
}) {
  const { run, error, isPending } = useActionRunner();
  const [name, setName] = useState(sequence?.name ?? '');
  const [description, setDescription] = useState(sequence?.description ?? '');
  const [steps, setSteps] = useState<Step[]>(
    sequence?.steps ?? [
      { id: 's1', day: 1, type: 'email', title: 'Introduction email', templateId: null },
      { id: 's2', day: 3, type: 'call', title: 'Follow-up call', templateId: null },
      { id: 's3', day: 7, type: 'email', title: 'Check-in email', templateId: null },
    ],
  );
  const update = (index: number, patch: Partial<Step>) =>
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveSequenceAction({
              id: sequence?.id,
              name,
              description,
              steps: steps.map((step) => ({ ...step, templateId: step.templateId ?? '' })),
            }),
          onDone,
        );
      }}
    >
      <Field name="seq-name" label="Sequence name" required>
        <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field name="seq-description" label="What it is for (optional)">
        <Input
          id="seq-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Steps (each becomes a task on its day)</legend>
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="grid gap-2 sm:grid-cols-[5rem_9rem_1fr_10rem_auto] sm:items-center"
          >
            <Input
              aria-label="Day"
              type="number"
              min={0}
              max={365}
              value={step.day}
              onChange={(e) => update(index, { day: Number(e.target.value) })}
            />
            <NativeSelect
              aria-label="Type"
              value={step.type}
              onChange={(e) => update(index, { type: e.target.value as Step['type'] })}
            >
              {SEQUENCE_STEP_TYPES.map((type) => (
                <option key={type} value={type}>
                  {STEP_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label="What to do"
              value={step.title}
              onChange={(e) => update(index, { title: e.target.value })}
            />
            <NativeSelect
              aria-label="Email template"
              disabled={step.type !== 'email'}
              value={step.templateId ?? ''}
              onChange={(e) => update(index, { templateId: e.target.value || null })}
            >
              <option value="">No template</option>
              {templates.map((template) => (
                <option key={template.value} value={template.value}>
                  {template.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Remove step"
              onClick={() => setSteps(steps.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() =>
            setSteps([
              ...steps,
              {
                id: crypto.randomUUID().slice(0, 8),
                day: (steps.at(-1)?.day ?? 0) + 3,
                type: 'follow_up',
                title: '',
                templateId: null,
              },
            ])
          }
        >
          <Plus aria-hidden /> Add step
        </Button>
      </fieldset>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          Save sequence
        </Button>
      </div>
    </form>
  );
}

export function SequencesEditor({
  sequences,
  templates,
}: {
  sequences: Sequence[];
  templates: { value: string; label: string }[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      {sequences.length === 0 && editing !== 'new' && (
        <p className="text-sm text-muted-foreground">No sequences yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {sequences.map((sequence) => (
          <li key={sequence.id} className="rounded-xl border bg-card px-4 py-2.5">
            {editing === sequence.id ? (
              <SequenceEdit
                sequence={sequence}
                templates={templates}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      !sequence.isActive && 'text-muted-foreground line-through',
                    )}
                  >
                    {sequence.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {sequence.steps
                      .map((step) => `Day ${step.day}: ${STEP_LABELS[step.type]}`)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(sequence.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() =>
                        toggleSequenceAction({ id: sequence.id, isActive: !sequence.isActive }),
                      )
                    }
                  >
                    {sequence.isActive ? 'Turn off' : 'Turn on'}
                  </Button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <SequenceEdit templates={templates} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add sequence
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
