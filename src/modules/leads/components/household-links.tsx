'use client';

import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { linkContactsAction, unlinkContactsAction } from '@/modules/leads/actions';

/** People linked to this one as a household or group (docs/leads.md §5.3). */
export function HouseholdLinks({
  contactId,
  links,
  options,
  relationships,
  canEdit,
}: {
  contactId: string;
  links: { linkId: string; contactId: string; name: string; relationship: string }[];
  options: { value: string; label: string }[];
  relationships: string[];
  canEdit: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [adding, setAdding] = useState(false);
  const [relatedContactId, setRelated] = useState('');
  const [relationship, setRelationship] = useState(relationships[0] ?? '');
  const available = options.filter(
    (option) =>
      option.value !== contactId && !links.some((link) => link.contactId === option.value),
  );

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one linked.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {links.map((link) => (
            <li key={link.linkId} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/contacts/${link.contactId}`} className="min-w-0 hover:text-primary">
                <span className="block truncate text-sm font-medium">{link.name}</span>
                <span className="text-xs text-muted-foreground">{link.relationship}</span>
              </Link>
              {canEdit && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Unlink ${link.name}`}
                  disabled={isPending}
                  onClick={() =>
                    run(() => unlinkContactsAction({ contactId, linkId: link.linkId }))
                  }
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => linkContactsAction({ contactId, relatedContactId, relationship }),
                () => {
                  setAdding(false);
                  setRelated('');
                },
              );
            }}
          >
            <NativeSelect
              aria-label="Person"
              value={relatedContactId}
              onChange={(event) => setRelated(event.target.value)}
            >
              <option value="">Choose a person…</option>
              {available.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Relationship"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
            >
              {relationships.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending || !relatedContactId}>
                Link
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Link a person
          </Button>
        ))}
    </div>
  );
}
