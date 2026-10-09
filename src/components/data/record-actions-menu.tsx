'use client';

import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ActionResult } from '@/lib/errors';

/**
 * One "Actions" menu per record header (docs/research/selma-analysis.md §4). Items are passed
 * in; delete is built in because every record type needs the same confirm-then-leave flow.
 */
export function RecordActionsMenu({
  recordName,
  items,
  onDelete,
  afterDeleteHref,
}: {
  recordName: string;
  items?: ReactNode;
  onDelete?: () => Promise<ActionResult<unknown>>;
  afterDeleteHref: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!items && !onDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="More actions">
            <MoreHorizontal aria-hidden />
            <span className="hidden sm:inline">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {items}
          {items && onDelete && <DropdownMenuSeparator />}
          {onDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {recordName}?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from lists and search. The change is recorded in the audit log and an
              administrator can restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              className="bg-destructive-text text-primary-foreground hover:bg-destructive-text/90"
              onClick={(event) => {
                event.preventDefault();
                if (!onDelete) return;
                startTransition(async () => {
                  const result = await onDelete();
                  if (!result.ok) {
                    setError(result.error.message);
                    return;
                  }
                  setConfirming(false);
                  router.push(afterDeleteHref);
                  router.refresh();
                });
              }}
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
