'use client';

import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
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
  publishWebFormAction,
  saveRoleAction,
} from '@/modules/crm-config/actions';
import { CopyButton } from '@/modules/crm-config/components/web-form-builder';

export type WebFormRow = {
  id: string;
  name: string;
  publicKey: string;
  leadType: 'b2b' | 'b2c';
  fieldCount: number;
  isActive: boolean;
};

/**
 * The business's website forms (docs/leads.md §3.1). Each is built on its own page; here they
 * are listed with whether they are live, and published ones can be copied onto a website.
 */
export function WebFormsEditor({ forms, appUrl }: { forms: WebFormRow[]; appUrl: string }) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className={cn('flex max-w-3xl flex-col gap-3', isPending && 'opacity-80')}>
      {forms.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No forms yet. Build one: choose its questions, preview it, then publish it to get its link
          and embed code.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {forms.map((form) => {
          const link = `${appUrl}/f/${form.publicKey}`;
          const embed = `<iframe src="${link}?embed=1" title="${form.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="width:100%;min-height:720px;border:0"></iframe>`;
          return (
            <li key={form.id} className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/settings/forms/${form.id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {form.name}
                  </Link>
                  <Badge variant={form.isActive ? 'default' : 'outline'}>
                    {form.isActive ? 'Published' : 'Draft'}
                  </Badge>
                  <Badge variant="outline">{form.leadType.toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {form.fieldCount} {form.fieldCount === 1 ? 'field' : 'fields'}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/settings/forms/${form.id}`}>
                      <Pencil aria-hidden /> Edit
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      run(() => publishWebFormAction({ id: form.id, publish: !form.isActive }))
                    }
                  >
                    {form.isActive ? 'Take offline' : 'Publish'}
                  </Button>
                </span>
              </div>
              {form.isActive && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-full truncate text-xs text-primary hover:underline"
                  >
                    {link}
                  </a>
                  <CopyButton text={link} label="Copy link" />
                  <CopyButton text={embed} label="Copy embed code" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button asChild variant="outline" className="w-fit">
        <Link href="/settings/forms/new">
          <Plus aria-hidden /> New form
        </Link>
      </Button>
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
