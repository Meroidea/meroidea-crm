'use client';

import { GitMerge } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { mergeContactsAction } from '@/modules/contacts/actions';

const MATCH: Record<string, string> = {
  email: 'Same email',
  phone: 'Same phone',
  name_dob: 'Same name and date of birth',
  company_name: 'Same name and company',
};

/**
 * Records that look like this person. Merging folds the other record into this one: its details
 * fill this record's gaps, and its timeline, tasks and opportunities move across.
 */
export function PossibleDuplicates({
  contactId,
  recordName,
  duplicates,
  canMerge,
}: {
  contactId: string;
  recordName: string;
  duplicates: { id: string; name: string; email: string | null; matchKind: string }[];
  canMerge: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [merging, setMerging] = useState<(typeof duplicates)[number] | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y">
        {duplicates.map((duplicate) => (
          <li key={duplicate.id} className="flex items-center justify-between gap-2 py-2">
            <Link href={`/contacts/${duplicate.id}`} className="min-w-0 hover:text-primary">
              <span className="block truncate text-sm font-medium">{duplicate.name}</span>
              <span className="text-xs text-muted-foreground">
                {MATCH[duplicate.matchKind] ?? 'Similar'}
                {duplicate.email ? ` · ${duplicate.email}` : ''}
              </span>
            </Link>
            {canMerge && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => setMerging(duplicate)}
              >
                <GitMerge aria-hidden /> Merge
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
      <AlertDialog open={merging !== null} onOpenChange={(open) => !open && setMerging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge {merging?.name} into this record?</AlertDialogTitle>
            <AlertDialogDescription>
              {recordName} is kept. Details it is missing are taken from {merging?.name}; nothing it
              already has is overwritten. Timeline, tasks, opportunities, organizations and
              sequences move across, and the other record is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={isPending}
              onClick={() => {
                if (!merging) return;
                run(
                  () => mergeContactsAction({ keepId: contactId, dropId: merging.id }),
                  () => setMerging(null),
                );
              }}
            >
              {isPending ? 'Merging…' : 'Merge'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
