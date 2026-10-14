'use client';

import { ShieldOff } from 'lucide-react';
import { useState } from 'react';

import { RecordActionsMenu } from '@/components/data/record-actions-menu';
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { anonymizeContactAction, deleteContactAction } from '@/modules/contacts/actions';

export function ContactActions({
  contactId,
  recordName,
  canDelete,
  canErase,
}: {
  contactId: string;
  recordName: string;
  canDelete: boolean;
  canErase: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [erasing, setErasing] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <>
      <RecordActionsMenu
        recordName={recordName}
        afterDeleteHref="/contacts"
        items={
          canErase ? (
            <DropdownMenuItem onSelect={() => setErasing(true)}>
              <ShieldOff aria-hidden /> Erase personal data
            </DropdownMenuItem>
          ) : undefined
        }
        onDelete={canDelete ? () => deleteContactAction({ id: contactId }) : undefined}
      />
      <AlertDialog
        open={erasing}
        onOpenChange={(open) => {
          setErasing(open);
          setTyped('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase {recordName}’s personal data?</AlertDialogTitle>
            <AlertDialogDescription>
              For a request to be forgotten. Their name, contact details, address, your own fields,
              notes and message text are cleared for good, here and in website submissions, support
              requests and the change history. The record stays as “Erased”, marked do-not-contact,
              so opportunities and reports still add up. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="erase-confirm">Type ERASE to confirm</Label>
            <Input
              id="erase-confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <ErrorNote error={error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isPending || typed.trim().toUpperCase() !== 'ERASE'}
              onClick={() =>
                run(
                  () => anonymizeContactAction({ id: contactId }),
                  () => setErasing(false),
                )
              }
            >
              {isPending ? 'Erasing…' : 'Erase for good'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
