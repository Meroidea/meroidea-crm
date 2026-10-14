'use client';

import { Check, Copy, Plus } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  deleteRoleAction,
  saveRoleAction,
  saveWebFormAction,
  toggleWebFormAction,
} from '@/modules/crm-config/actions';

type SourceOption = { id: string; name: string; subSources: { id: string; name: string }[] };

export type WebFormRow = {
  id: string;
  name: string;
  publicKey: string;
  sourceId: string;
  subSourceId: string | null;
  leadType: 'b2b' | 'b2c';
  thankYouMessage: string | null;
  askCompany: boolean;
  askMessage: boolean;
  askConsent: boolean;
  isActive: boolean;
};

function CopyButton({ text, label }: { text: string; label: string }) {
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

function WebFormEdit({
  form,
  sources,
  leadTypes,
  onDone,
}: {
  form?: WebFormRow;
  sources: SourceOption[];
  leadTypes: ('b2b' | 'b2c')[];
  onDone: () => void;
}) {
  const { run, error, isPending } = useActionRunner();
  const website = sources.find((source) => source.name.toLowerCase() === 'website');
  const [values, setValues] = useState({
    name: form?.name ?? '',
    sourceId: form?.sourceId ?? website?.id ?? '',
    subSourceId: form?.subSourceId ?? '',
    leadType: form?.leadType ?? leadTypes[0] ?? 'b2c',
    thankYouMessage: form?.thankYouMessage ?? '',
    askCompany: form?.askCompany ?? false,
    askMessage: form?.askMessage ?? true,
    askConsent: form?.askConsent ?? true,
  });
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));
  const subs = sources.find((source) => source.id === values.sourceId)?.subSources ?? [];

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => saveWebFormAction({ id: form?.id, ...values }), onDone);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="wf-name" label="Form name" required>
          <Input
            id="wf-name"
            placeholder="Contact us"
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field name="wf-type" label="Leads are">
          <NativeSelect
            id="wf-type"
            value={values.leadType}
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
            value={values.sourceId}
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
            value={values.subSourceId}
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
        <Field name="wf-thanks" label="Thank-you message" className="sm:col-span-2">
          <Input
            id="wf-thanks"
            placeholder="Thanks — we’ll be in touch shortly."
            value={values.thankYouMessage}
            onChange={(e) => set({ thankYouMessage: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={values.askCompany}
            onChange={(e) => set({ askCompany: e.target.checked })}
          />
          Ask for company and job title
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={values.askMessage}
            onChange={(e) => set({ askMessage: e.target.checked })}
          />
          Ask for a message
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={values.askConsent}
            onChange={(e) => set({ askConsent: e.target.checked })}
          />
          Ask for marketing consent
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          Save form
        </Button>
      </div>
    </form>
  );
}

export function WebFormsEditor({
  forms,
  sources,
  leadTypes,
  appUrl,
}: {
  forms: WebFormRow[];
  sources: SourceOption[];
  leadTypes: ('b2b' | 'b2c')[];
  appUrl: string;
}) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      {forms.length === 0 && editing !== 'new' && (
        <p className="text-sm text-muted-foreground">
          No forms yet. Each form gets its own page and embed code.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {forms.map((form) => {
          const link = `${appUrl}/f/${form.publicKey}`;
          const embed = `<iframe src="${link}?embed=1" title="${form.name.replace(/"/g, '&quot;')}" style="width:100%;min-height:640px;border:0"></iframe>`;
          return (
            <li key={form.id} className="rounded-xl border bg-card px-4 py-3">
              {editing === form.id ? (
                <WebFormEdit
                  form={form}
                  sources={sources}
                  leadTypes={leadTypes}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          !form.isActive && 'text-muted-foreground line-through',
                        )}
                      >
                        {form.name}
                      </span>
                      <Badge variant="outline">{form.leadType.toUpperCase()}</Badge>
                    </span>
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(form.id)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          run(() => toggleWebFormAction({ id: form.id, isActive: !form.isActive }))
                        }
                      >
                        {form.isActive ? 'Turn off' : 'Turn on'}
                      </Button>
                    </span>
                  </div>
                  {form.isActive && (
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs text-primary hover:underline"
                      >
                        {link}
                      </a>
                      <CopyButton text={link} label="Copy link" />
                      <CopyButton text={embed} label="Copy embed code" />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing === 'new' ? (
        <WebFormEdit sources={sources} leadTypes={leadTypes} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add form
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export type PermissionGroup = {
  title: string;
  permissions: { key: string; label: string; scoped: boolean }[];
};
export type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  people: number;
  grants: Record<string, 'own' | 'team' | 'all' | 'true'>;
};

function RoleEdit({
  role,
  groups,
  templates,
  onDone,
}: {
  role?: RoleRow;
  groups: PermissionGroup[];
  templates: { key: string; name: string; description: string; grants: Record<string, string> }[];
  onDone: () => void;
}) {
  const { run, error, isPending } = useActionRunner();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [grants, setGrants] = useState<Record<string, string>>(role?.grants ?? {});
  const setGrant = (key: string, value: string) => {
    const next = { ...grants };
    if (value) next[key] = value;
    else delete next[key];
    setGrants(next);
  };
  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveRoleAction({
              id: role?.id,
              name,
              description,
              grants: grants as Record<string, 'own' | 'team' | 'all' | 'true'>,
            }),
          onDone,
        );
      }}
    >
      {!role && (
        <Field name="role-template" label="Start from">
          <NativeSelect
            id="role-template"
            defaultValue=""
            onChange={(e) => {
              const template = templates.find((candidate) => candidate.key === e.target.value);
              if (!template) return;
              setName(template.name);
              setDescription(template.description);
              setGrants(
                Object.fromEntries(
                  Object.entries(template.grants).map(([key, value]) => [
                    key,
                    value === 'true' ? 'true' : String(value),
                  ]),
                ),
              );
            }}
          >
            <option value="">A blank role</option>
            {templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="role-name" label="Role name" required>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field name="role-description" label="What it is for">
          <Input
            id="role-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
      {groups.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-1.5">
          <legend className="text-sm font-semibold">{group.title}</legend>
          {group.permissions.map((permission) => (
            <div key={permission.key} className="flex items-center justify-between gap-2 text-sm">
              <span>{permission.label}</span>
              {permission.scoped ? (
                <NativeSelect
                  aria-label={permission.label}
                  className="h-8 w-36"
                  value={grants[permission.key] ?? ''}
                  onChange={(e) => setGrant(permission.key, e.target.value)}
                >
                  <option value="">No</option>
                  <option value="own">Their own</option>
                  <option value="team">Their team’s</option>
                  <option value="all">Everyone’s</option>
                </NativeSelect>
              ) : (
                <input
                  type="checkbox"
                  aria-label={permission.label}
                  className="size-4 accent-primary"
                  checked={grants[permission.key] === 'true'}
                  onChange={(e) => setGrant(permission.key, e.target.checked ? 'true' : '')}
                />
              )}
            </div>
          ))}
        </fieldset>
      ))}
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
          Save role
        </Button>
      </div>
    </form>
  );
}

export function RolesEditor({
  roles,
  groups,
  templates,
}: {
  roles: RoleRow[];
  groups: PermissionGroup[];
  templates: { key: string; name: string; description: string; grants: Record<string, string> }[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      <ul className="flex flex-col gap-2">
        {roles.map((role) => (
          <li key={role.id} className="rounded-xl border bg-card px-4 py-2.5">
            {editing === role.id ? (
              <RoleEdit
                role={role}
                groups={groups}
                templates={templates}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {role.name}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {role.people} {role.people === 1 ? 'person' : 'people'}
                    </span>
                  </span>
                  {role.description && (
                    <span className="block text-xs text-muted-foreground">{role.description}</span>
                  )}
                </span>
                {role.key === 'owner' ? (
                  <span className="text-xs text-muted-foreground">Always has everything</span>
                ) : (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(role.id)}>
                      Edit
                    </Button>
                    {!['manager', 'member'].includes(role.key) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={role.people > 0}
                        onClick={() => run(() => deleteRoleAction({ id: role.id }))}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <RoleEdit groups={groups} templates={templates} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add role
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
