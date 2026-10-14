'use client';

import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveCrmSettingsAction } from '@/modules/crm-config/actions';
import {
  LEAD_FIELD_KEYS,
  LEAD_FIELD_LABELS,
  WORKFLOW_LABELS,
  WORKFLOWS,
  type CrmSettings,
} from '@/modules/leads/settings';

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function FieldPicker({
  legend,
  hint,
  value,
  onChange,
  customFields,
}: {
  legend: string;
  hint: string;
  value: string[];
  onChange: (next: string[]) => void;
  customFields: { key: string; label: string }[];
}) {
  const options = [
    ...LEAD_FIELD_KEYS.map((key) => ({ ref: key, label: LEAD_FIELD_LABELS[key] })),
    ...customFields.map((field) => ({ ref: `custom:${field.key}`, label: field.label })),
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.ref} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.includes(option.ref)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.ref]
                    : value.filter((ref) => ref !== option.ref),
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

export function CrmSettingsForm({
  initial,
  customFields,
}: {
  initial: CrmSettings;
  customFields: { key: string; label: string }[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [outcomes, setOutcomes] = useState(initial.callOutcomes.join('\n'));
  const [roles, setRoles] = useState(initial.contactRoles.join('\n'));
  const [relationships, setRelationships] = useState(initial.householdRelationships.join('\n'));
  const set = (patch: Partial<CrmSettings>) => {
    setSaved(false);
    setSettings((current) => ({ ...current, ...patch }));
  };
  const setSla = (key: keyof CrmSettings['sla'], value: string) =>
    set({ sla: { ...settings.sla, [key]: Number(value) || 1 } });

  return (
    <form
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveCrmSettingsAction({
              ...settings,
              callOutcomes: lines(outcomes),
              contactRoles: lines(roles),
              householdRelationships: lines(relationships),
            }),
          () => setSaved(true),
        );
      }}
    >
      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Workflow</h3>
        <Field name="workflow" label="Who you sell to">
          <NativeSelect
            id="workflow"
            value={settings.workflow}
            onChange={(event) => set({ workflow: event.target.value as CrmSettings['workflow'] })}
          >
            {WORKFLOWS.map((workflow) => (
              <option key={workflow} value={workflow}>
                {WORKFLOW_LABELS[workflow]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {settings.workflow !== 'b2b' && (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={settings.b2cQualificationStep}
                onChange={(event) => set({ b2cQualificationStep: event.target.checked })}
              />
              <span>
                B2C leads go through an SDR/BDR qualification step first
                <span className="block text-xs text-muted-foreground">
                  They are worked, then handed to a team member who accepts or returns them, like
                  B2B.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={settings.b2cApproval}
                onChange={(event) => set({ b2cApproval: event.target.checked })}
              />
              <span>
                Converting a B2C lead needs someone’s approval
                <span className="block text-xs text-muted-foreground">
                  Team members submit it for approval instead of converting it themselves.
                </span>
              </span>
            </label>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Response times</h3>
        <p className="text-sm text-muted-foreground">
          Leads past these limits are flagged, and the owner and their manager are notified.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="sla-unassigned" label="Flag unassigned leads after (hours)">
            <Input
              id="sla-unassigned"
              type="number"
              min={1}
              max={720}
              value={settings.sla.unassignedHours}
              onChange={(e) => setSla('unassignedHours', e.target.value)}
            />
          </Field>
          <Field name="sla-first" label="First contact within (hours)">
            <Input
              id="sla-first"
              type="number"
              min={1}
              max={720}
              value={settings.sla.firstContactHours}
              onChange={(e) => setSla('firstContactHours', e.target.value)}
            />
          </Field>
          <Field name="sla-accept" label="Accept or reject a handover within (business days)">
            <Input
              id="sla-accept"
              type="number"
              min={1}
              max={30}
              value={settings.sla.acceptanceBusinessDays}
              onChange={(e) => setSla('acceptanceBusinessDays', e.target.value)}
            />
          </Field>
          <Field name="sla-stale" label="A lead with no activity is stale after (days)">
            <Input
              id="sla-stale"
              type="number"
              min={1}
              max={365}
              value={settings.sla.staleLeadDays}
              onChange={(e) => setSla('staleLeadDays', e.target.value)}
            />
          </Field>
        </div>
      </section>

      <FieldPicker
        legend="Fields that count towards completeness"
        hint="The completeness score on each lead shows how many of these are filled in."
        value={settings.completenessFields}
        onChange={(completenessFields) => set({ completenessFields })}
        customFields={customFields}
      />
      <FieldPicker
        legend="Fields required before a handover"
        hint="An SDR/BDR can’t hand a lead to a sales rep until these are filled in."
        value={settings.handoverRequiredFields}
        onChange={(handoverRequiredFields) => set({ handoverRequiredFields })}
        customFields={customFields}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Field name="call-outcomes" label="Call outcomes" hint="One per line.">
          <Textarea
            id="call-outcomes"
            rows={7}
            value={outcomes}
            onChange={(e) => {
              setSaved(false);
              setOutcomes(e.target.value);
            }}
          />
        </Field>
        <Field name="contact-roles" label="Roles at a company" hint="Decision maker, influencer…">
          <Textarea
            id="contact-roles"
            rows={7}
            value={roles}
            onChange={(e) => {
              setSaved(false);
              setRoles(e.target.value);
            }}
          />
        </Field>
        <Field name="relationships" label="Household relationships" hint="Parent, partner…">
          <Textarea
            id="relationships"
            rows={7}
            value={relationships}
            onChange={(e) => {
              setSaved(false);
              setRelationships(e.target.value);
            }}
          />
        </Field>
      </section>

      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save lead settings'}
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
