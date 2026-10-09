'use client';

import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Moving to a lost stage always asks why (docs/database.md §10). */
export function LostReasonDialog({
  open,
  reasons,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  reasons: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (reasonId: string, note: string) => void;
  pending?: boolean;
}) {
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Why was it lost?</AlertDialogTitle>
          <AlertDialogDescription>
            This feeds the lost-reasons report, so the team can see patterns.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-reason">Reason</Label>
            <NativeSelect
              id="lost-reason"
              value={reasonId}
              onChange={(event) => setReasonId(event.target.value)}
            >
              <option value="">Choose a reason…</option>
              {reasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-note">Note (optional)</Label>
            <Textarea
              id="lost-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button disabled={!reasonId || pending} onClick={() => onConfirm(reasonId, note)}>
            {pending ? 'Saving…' : 'Mark as lost'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
