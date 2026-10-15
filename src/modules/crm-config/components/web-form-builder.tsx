'use client';

import { ArrowDown, ArrowUp, Check, Copy, Eye, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { keyFromLabel, type CustomFieldType } from '@/modules/custom-fields/validation';
import {
  publishWebFormAction,
  saveCustomFieldAction,
  saveWebFormAction,
} from '@/modules/crm-config/actions';
import { WebForm } from '@/modules/leads/components/web-form';
import {
  CUSTOM_KIND,
  DEFAULT_FORM_FIELDS,
  formFieldsSchema,
  renderFields,
  STANDARD_FORM_FIELDS,
  standardField,
  type FormField,
  type RenderedField,
} from '@/modules/leads/form-fields';

type SourceOption = { id: string; name: string; subSources: { id: string; name: string }[] };
export type BuilderCustomField = {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  choices: { value: string; label: string }[];
  isActive: boolean;
};
export type BuilderForm = {
  id: string;
  name: string;
  publicKey: string;
  sourceId: string;
  subSourceId: string | null;
  leadType: 'b2b' | 'b2c';
  heading: string | null;
  intro: string | null;
  submitLabel: string | null;
  thankYouMessage: string | null;
  fields: FormField[];
  isActive: boolean;
};

const QUESTION_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'select', label: 'Choose one' },
  { value: 'multi_select', label: 'Choose several' },
  { value: 'boolean', label: 'Yes / no tick box' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'Web address' },
];

const KIND_WORDS: Record<RenderedField['kind'], string> = {
  text: 'short answer',
  textarea: 'long answer',
  email: 'email',
  phone: 'phone',
  url: 'web address',
  number: 'number',
  date: 'date',
  checkbox: 'tick box',
  select: 'choose one',
  multi_select: 'choose several',
};

const newId = () => Math.random().toString(36).slice(2, 10);

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : label}
    </Button>
  );
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A plain HTML version of the form, for a site that styles its own: same names, same rules. */
export function formHtml(action: string, fields: RenderedField[], submitLabel: string | null) {
  const lines = [`<form action="${action}" method="post">`];
  for (const field of fields) {
    const name = escapeAttribute(field.target);
    const label = escapeAttribute(field.label);
    const required = field.required ? ' required' : '';
    if (field.kind === 'checkbox') {
      lines.push(`  <label><input type="checkbox" name="${name}"${required}> ${label}</label>`);
    } else if (field.kind === 'textarea') {
      lines.push(`  <label>${label}<br><textarea name="${name}"${required}></textarea></label>`);
    } else if (field.kind === 'select') {
      lines.push(
        `  <label>${label}<br><select name="${name}"${required}>`,
        '    <option value="">Choose…</option>',
      );
      for (const choice of field.choices) {
        lines.push(
          `    <option value="${escapeAttribute(choice.value)}">${escapeAttribute(choice.label)}</option>`,
        );
      }
      lines.push('  </select></label>');
    } else if (field.kind === 'multi_select') {
      lines.push(`  <fieldset><legend>${label}</legend>`);
      for (const choice of field.choices) {
        lines.push(
          `    <label><input type="checkbox" name="${name}" value="${escapeAttribute(choice.value)}"> ${escapeAttribute(choice.label)}</label>`,
        );
      }
      lines.push('  </fieldset>');
    } else {
      const type = { email: 'email', phone: 'tel', url: 'url', number: 'number', date: 'date' }[
        field.kind as string
      ];
      lines.push(
        `  <label>${label}<br><input name="${name}"${type ? ` type="${type}"` : ''}${required}></label>`,
      );
    }
  }
  lines.push(
    '  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">',
    `  <button type="submit">${escapeAttribute(submitLabel || 'Send enquiry')}</button>`,
    '</form>',
  );
  return lines.join('\n');
}

function describe(field: FormField, custom: BuilderCustomField[]) {
  if (field.target.startsWith('custom.')) {
    const definition = custom.find((item) => `custom.${item.key}` === field.target);
    return definition
      ? `Your field “${definition.label}” · ${KIND_WORDS[CUSTOM_KIND[definition.fieldType]]}`
      : 'A field that was switched off — remove it';
  }
  const standard = standardField(field.target);
  return standard ? `${standard.group} · ${KIND_WORDS[standard.kind]}` : 'Unknown field';
}

/**
 * The website form builder (docs/leads.md §3.1): the admin chooses the questions, their order,
 * wording and which are required, adds questions of their own, and sees the form as visitors
 * will. A new form stays a draft until it is published.
 */
export function WebFormBuilder({
  form,
  businessName,
  sources,
  leadTypes,
  customFields,
  appUrl,
}: {
  form: BuilderForm | null;
  businessName: string;
  sources: SourceOption[];
  leadTypes: ('b2b' | 'b2c')[];
  customFields: BuilderCustomField[];
  appUrl: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const website = sources.find((source) => source.name.toLowerCase() === 'website');
  const [details, setDetails] = useState({
    name: form?.name ?? '',
    heading: form?.heading ?? '',
    intro: form?.intro ?? '',
    leadType: form?.leadType ?? leadTypes[0] ?? 'b2c',
    sourceId: form?.sourceId ?? website?.id ?? '',
    subSourceId: form?.subSourceId ?? '',
    submitLabel: form?.submitLabel ?? '',
    thankYouMessage: form?.thankYouMessage ?? '',
  });
  const [fields, setFields] = useState<FormField[]>(
    form?.fields.length ? form.fields : DEFAULT_FORM_FIELDS,
  );
  const [custom, setCustom] = useState(customFields);
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState({
    label: '',
    fieldType: 'select' as CustomFieldType,
    choices: '',
  });
  const set = (patch: Partial<typeof details>) =>
    setDetails((current) => ({ ...current, ...patch }));
  const subs = sources.find((source) => source.id === details.sourceId)?.subSources ?? [];
  const rendered = renderFields(fields, custom);
  const used = new Set(fields.map((field) => field.target));
  const published = form?.isActive ?? false;
  const link = form ? `${appUrl}/f/${form.publicKey}` : '';

  const update = (id: string, patch: Partial<FormField>) =>
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );
  const move = (index: number, by: number) =>
    setFields((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + by, 0, item);
      return next;
    });
  const addTarget = (target: string, label: string) =>
    setFields((current) => [
      ...current,
      { id: newId(), target, label, required: false, help: null },
    ]);

  const save = (then?: 'publish' | 'unpublish') =>
    startTransition(async () => {
      setError(null);
      setSaved(null);
      const check = formFieldsSchema.safeParse(fields);
      if (!check.success) {
        setError(check.error.issues[0]?.message ?? 'Check the fields.');
        return;
      }
      const result = await saveWebFormAction({ id: form?.id, ...details, fields });
      if (!result.ok) {
        setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
        return;
      }
      if (then) {
        const toggled = await publishWebFormAction({
          id: result.data.id,
          publish: then === 'publish',
        });
        if (!toggled.ok) {
          setError(toggled.error.message);
          return;
        }
      }
      setSaved(
        then === 'publish' ? 'Published.' : then === 'unpublish' ? 'Taken offline.' : 'Saved.',
      );
      if (!form) router.replace(`/settings/forms/${result.data.id}`);
      router.refresh();
    });

  const createQuestion = () =>
    startTransition(async () => {
      setError(null);
      const choices =
        question.fieldType === 'select' || question.fieldType === 'multi_select'
          ? question.choices
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          : [];
      const result = await saveCustomFieldAction({
        entityType: 'contact',
        label: question.label,
        fieldType: question.fieldType,
        choices,
        isRequired: false,
        showInList: false,
      });
      if (!result.ok) {
        setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
        return;
      }
      setCustom((current) => [
        ...current,
        {
          key: result.data.key,
          label: question.label.trim(),
          fieldType: question.fieldType,
          // The same values the server stores (saveCustomField), so the HTML form posts them.
          choices: choices.map((label) => ({ value: keyFromLabel(label), label })),
          isActive: true,
        },
      ]);
      addTarget(`custom.${result.data.key}`, question.label.trim());
      setQuestion({ label: '', fieldType: 'select', choices: '' });
      setAdding(false);
    });

  const groups = [...new Set(STANDARD_FORM_FIELDS.map((field) => field.group))];
  const freeCustom = custom.filter((item) => item.isActive && !used.has(`custom.${item.key}`));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle>About the form</CardTitle>
              <CardDescription>Where its leads come from, and what visitors see.</CardDescription>
            </div>
            <Badge variant={published ? 'default' : 'outline'}>
              {published ? 'Published' : 'Draft'}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field name="wf-name" label="Form name (for your team)" required>
              <Input
                id="wf-name"
                placeholder="Free study consultation"
                maxLength={80}
                value={details.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field name="wf-type" label="Leads are">
              <NativeSelect
                id="wf-type"
                value={details.leadType}
                onChange={(e) => set({ leadType: e.target.value as 'b2b' | 'b2c' })}
              >
                {leadTypes.map((type) => (
                  <option key={type} value={type}>
                    {type === 'b2b' ? 'Businesses (B2B)' : 'Individuals (B2C)'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name="wf-source" label="Source" required>
              <NativeSelect
                id="wf-source"
                value={details.sourceId}
                onChange={(e) => set({ sourceId: e.target.value, subSourceId: '' })}
              >
                <option value="">Choose…</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name="wf-sub" label="Sub-source">
              <NativeSelect
                id="wf-sub"
                value={details.subSourceId}
                disabled={subs.length === 0}
                onChange={(e) => set({ subSourceId: e.target.value })}
              >
                <option value="">None</option>
                {subs.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name="wf-heading" label="Heading on the page" className="sm:col-span-2">
              <Input
                id="wf-heading"
                maxLength={120}
                placeholder={details.name || 'Get in touch'}
                value={details.heading}
                onChange={(e) => set({ heading: e.target.value })}
              />
            </Field>
            <Field name="wf-intro" label="Introduction (optional)" className="sm:col-span-2">
              <Textarea
                id="wf-intro"
                rows={2}
                maxLength={1000}
                placeholder="Tell us a little about your plans and a counsellor will call you within a day."
                value={details.intro}
                onChange={(e) => set({ intro: e.target.value })}
              />
            </Field>
            <Field name="wf-submit" label="Button text">
              <Input
                id="wf-submit"
                maxLength={40}
                placeholder="Send enquiry"
                value={details.submitLabel}
                onChange={(e) => set({ submitLabel: e.target.value })}
              />
            </Field>
            <Field name="wf-thanks" label="Thank-you message">
              <Input
                id="wf-thanks"
                maxLength={300}
                placeholder="Thanks — we’ll be in touch shortly."
                value={details.thankYouMessage}
                onChange={(e) => set({ thankYouMessage: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fields</CardTitle>
            <CardDescription>
              Choose what the form asks, in the order shown. A first name is always asked, and an
              email or phone must be required so the team can reply. Every answer is saved on the
              lead.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ol className="flex flex-col gap-2">
              {fields.map((field, index) => {
                const locked = field.target === 'firstName';
                return (
                  <li key={field.id} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                        <Input
                          aria-label={`Label for field ${index + 1}`}
                          value={field.label}
                          maxLength={200}
                          onChange={(e) => update(field.id, { label: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">{describe(field, custom)}</p>
                        <Input
                          aria-label={`Help text for ${field.label}`}
                          placeholder="Help text under the field (optional)"
                          className="h-8 text-xs"
                          maxLength={200}
                          value={field.help ?? ''}
                          onChange={(e) => update(field.id, { help: e.target.value || null })}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="mr-1 flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            aria-label={`Required: ${field.label}`}
                            checked={field.required}
                            disabled={locked}
                            onChange={(e) => update(field.id, { required: e.target.checked })}
                          />
                          Required
                        </label>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Move ${field.label} up`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Move ${field.label} down`}
                          disabled={index === fields.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${field.label}`}
                          disabled={locked}
                          onClick={() =>
                            setFields((current) => current.filter((item) => item.id !== field.id))
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-end gap-2">
              <Field name="wf-add" label="Add a field" className="min-w-56 flex-1">
                <NativeSelect
                  id="wf-add"
                  value=""
                  onChange={(e) => {
                    const target = e.target.value;
                    if (!target) return;
                    const standard = standardField(target);
                    const own = custom.find((item) => `custom.${item.key}` === target);
                    addTarget(target, standard?.label ?? own?.label ?? target);
                  }}
                >
                  <option value="">Choose a field to add…</option>
                  {groups.map((group) => (
                    <optgroup key={group} label={group}>
                      {STANDARD_FORM_FIELDS.filter((field) => field.group === group).map(
                        (field) => (
                          <option
                            key={field.target}
                            value={field.target}
                            disabled={used.has(field.target)}
                          >
                            {field.target === 'consent' ? 'Marketing consent' : field.label}
                          </option>
                        ),
                      )}
                    </optgroup>
                  ))}
                  {freeCustom.length > 0 && (
                    <optgroup label="Your own fields">
                      {freeCustom.map((item) => (
                        <option key={item.key} value={`custom.${item.key}`}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </NativeSelect>
              </Field>
              <Button type="button" variant="outline" onClick={() => setAdding((value) => !value)}>
                <Plus aria-hidden /> New question
              </Button>
            </div>

            {adding && (
              <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
                <p className="text-sm text-muted-foreground">
                  A new question is also added to every contact’s record (Settings → Fields and
                  names), so answers can be searched, filtered and reported on.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field name="wf-q-label" label="Question" required>
                    <Input
                      id="wf-q-label"
                      maxLength={60}
                      placeholder="Which visa are you interested in?"
                      value={question.label}
                      onChange={(e) => setQuestion((q) => ({ ...q, label: e.target.value }))}
                    />
                  </Field>
                  <Field name="wf-q-type" label="Answer type">
                    <NativeSelect
                      id="wf-q-type"
                      value={question.fieldType}
                      onChange={(e) =>
                        setQuestion((q) => ({ ...q, fieldType: e.target.value as CustomFieldType }))
                      }
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {(question.fieldType === 'select' || question.fieldType === 'multi_select') && (
                    <Field
                      name="wf-q-choices"
                      label="Choices, one per line"
                      className="sm:col-span-2"
                    >
                      <Textarea
                        id="wf-q-choices"
                        rows={4}
                        placeholder={
                          'Student visa (500)\nGraduate visa (485)\nSkilled visa (189/190/491)'
                        }
                        value={question.choices}
                        onChange={(e) => setQuestion((q) => ({ ...q, choices: e.target.value }))}
                      />
                    </Field>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || !question.label.trim()}
                    onClick={createQuestion}
                  >
                    Add question
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <ErrorNote error={error} />
        {saved && (
          <p role="status" className="text-sm text-primary">
            {saved}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {published ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => save('unpublish')}
              >
                Take offline
              </Button>
              <Button type="button" disabled={isPending} onClick={() => save()}>
                {isPending ? 'Saving…' : 'Save changes (live)'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => save()}>
                Save draft
              </Button>
              <Button type="button" disabled={isPending} onClick={() => save('publish')}>
                {isPending ? 'Saving…' : 'Save and publish'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Eye aria-hidden className="size-4" /> Preview — how visitors will see it
        </p>
        <Card>
          <CardHeader className="text-center">
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {businessName}
            </p>
            <CardTitle role="heading" aria-level={2} className="text-xl text-balance">
              {details.heading || details.name || 'Get in touch'}
            </CardTitle>
            {details.intro && (
              <p className="text-sm whitespace-pre-line text-muted-foreground">{details.intro}</p>
            )}
          </CardHeader>
          <CardContent>
            <WebForm
              key={JSON.stringify(rendered.map((field) => field.target))}
              businessName={businessName}
              fields={rendered}
              submitLabel={details.submitLabel || null}
              thankYouMessage={details.thankYouMessage || null}
              preview
            />
          </CardContent>
        </Card>
        {form && published && (
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <p className="text-sm font-medium">Put it on your website</p>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-primary hover:underline"
            >
              {link}
            </a>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={link} label="Copy link" />
              <CopyButton
                text={`<iframe src="${link}?embed=1" title="${escapeAttribute(details.heading || details.name)}" style="width:100%;min-height:720px;border:0"></iframe>`}
                label="Copy embed code"
              />
              <CopyButton
                text={formHtml(
                  `${appUrl}/api/forms/${form.publicKey}`,
                  rendered,
                  details.submitLabel || null,
                )}
                label="Copy HTML form"
              />
            </div>
          </div>
        )}
        {form && !published && (
          <p className="text-xs text-muted-foreground">
            The link and embed code appear here once the form is published. Until then nobody
            outside your team can open it.
          </p>
        )}
      </div>
    </div>
  );
}
