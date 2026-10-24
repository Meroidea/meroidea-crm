'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LABEL_KEYS, type LabelKey, type Labels } from '@/lib/tenant/labels';
import { cn } from '@/lib/utils';
import {
  saveCustomFieldAction,
  saveLabelsAction,
  toggleCustomFieldAction,
} from '@/modules/crm-config/actions';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomEntity,
  type CustomFieldDefinition,
  type CustomFieldType,
} from '@/modules/custom-fields/validation';

function FieldEdit({
  entity,
  field,
  onDone,
}: {
  entity: CustomEntity;
  field?: CustomFieldDefinition;
  onDone: () => void;
}) {
  const { run, error, isPending } = useActionRunner();
  const [label, setLabel] = useState(field?.label ?? '');
  const [description, setDescription] = useState(field?.description ?? '');
  const [fieldType, setFieldType] = useState<CustomFieldType>(field?.fieldType ?? 'text');
  const [choices, setChoices] = useState(
    // Retired options are no longer on the list, so they are not edited here.
    field?.choices
      .filter((choice) => !choice.retired)
      .map((choice) => choice.label)
      .join('\n') ?? '',
  );
  const [isRequired, setRequired] = useState(field?.isRequired ?? false);
  const [showInList, setShowInList] = useState(field?.showInList ?? false);
  const hasChoices = fieldType === 'select' || fieldType === 'multi_select';

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveCustomFieldAction({
              id: field?.id,
              entityType: entity,
              label,
              description,
              fieldType,
              choices: choices
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
              isRequired,
              showInList,
            }),
          onDone,
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="cf-label" label="Label" required>
          <Input id="cf-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field name="cf-type" label="Type" hint={field ? 'Fixed once created.' : undefined}>
          <NativeSelect
            id="cf-type"
            value={fieldType}
            disabled={Boolean(field)}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
          >
            {CUSTOM_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {CUSTOM_FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="cf-description" label="Help text (optional)" className="sm:col-span-2">
          <Input
            id="cf-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {hasChoices && (
          <Field name="cf-choices" label="Options" hint="One per line." className="sm:col-span-2">
            <Textarea
              id="cf-choices"
              rows={4}
              value={choices}
              onChange={(e) => setChoices(e.target.value)}
            />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={isRequired}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={showInList}
            onChange={(e) => setShowInList(e.target.checked)}
          />
          Show in lists
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !label.trim()}>
          Save field
        </Button>
      </div>
    </form>
  );
}

export function CustomFieldsEditor({
  entity,
  fields,
}: {
  entity: CustomEntity;
  fields: CustomFieldDefinition[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      {fields.length === 0 && editing !== 'new' && (
        <p className="text-sm text-muted-foreground">No fields of your own yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {fields.map((field) => (
          <li key={field.id} className="rounded-xl border bg-card px-4 py-2.5">
            {editing === field.id ? (
              <FieldEdit entity={entity} field={field} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      !field.isActive && 'text-muted-foreground line-through',
                    )}
                  >
                    {field.label}
                  </span>
                  <Badge variant="outline">{CUSTOM_FIELD_TYPE_LABELS[field.fieldType]}</Badge>
                  {field.isRequired && (
                    <span className="text-xs text-muted-foreground">required</span>
                  )}
                  <code className="text-xs text-muted-foreground">{field.key}</code>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(field.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() =>
                        toggleCustomFieldAction({ id: field.id, isActive: !field.isActive }),
                      )
                    }
                  >
                    {field.isActive ? 'Turn off' : 'Turn on'}
                  </Button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <FieldEdit entity={entity} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add field
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

const LABEL_NAMES: Record<LabelKey, string> = {
  contact: 'Contact (a person)',
  organization: 'Organization (an account or company)',
  opportunity: 'Opportunity (a deal, case or application)',
  opportunityItem: 'Opportunity item (an application, an offer)',
  partner: 'Partner',
  product: 'Product',
};

export function LabelsForm({ labels }: { labels: Labels }) {
  const { run, error, isPending } = useActionRunner();
  const [values, setValues] = useState(labels);
  const [saved, setSaved] = useState(false);
  const shown: readonly LabelKey[] = LABEL_KEYS;
  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => saveLabelsAction(values),
          () => setSaved(true),
        );
      }}
    >
      {shown.map((key) => (
        <fieldset key={key} className="grid gap-2 sm:grid-cols-[14rem_1fr_1fr] sm:items-end">
          <legend className="text-sm font-medium sm:col-span-3">{LABEL_NAMES[key]}</legend>
          <span className="hidden sm:block" />
          <Input
            aria-label={`${LABEL_NAMES[key]}, singular`}
            value={values[key].singular}
            onChange={(e) => {
              setSaved(false);
              setValues({ ...values, [key]: { ...values[key], singular: e.target.value } });
            }}
          />
          <Input
            aria-label={`${LABEL_NAMES[key]}, plural`}
            value={values[key].plural}
            onChange={(e) => {
              setSaved(false);
              setValues({ ...values, [key]: { ...values[key], plural: e.target.value } });
            }}
          />
        </fieldset>
      ))}
      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save names'}
        </Button>
        {saved && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
