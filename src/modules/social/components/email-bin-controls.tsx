'use client';

import { Loader2, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
import { cn } from '@/lib/utils';

import {
  binEmailAction,
  emptyEmailBinAction,
  importantEmailAction,
  purgeEmailAction,
  restoreEmailAction,
} from '../actions';

/*
 * Bin and Important (ADR-093): in each row of the email list, and in an open thread's header.
 * Delete puts a thread in the Bin for 30 days; only "Delete forever" and "Empty Bin" (managers)
 * cannot be undone, so only they ask first.
 */

type Result = { ok: true } | { ok: false; error: { message: string } };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<Result>, then?: () => void) =>
    start(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (then) then();
      else router.refresh();
    });
  return { pending, error, run };
}

function ForeverDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete forever
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Shown on a phone; on a desktop when the row is pointed at or has focus. */
const onHover =
  'lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100';

const iconButton =
  'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';

/** The star and the delete button on one row of the email list. */
export function EmailRowActions({
  conversationId,
  important,
  inBin,
  canReply,
  canManage,
}: {
  conversationId: string;
  important: boolean;
  inBin: boolean;
  canReply: boolean;
  canManage: boolean;
}) {
  const { pending, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const ids = { conversationIds: [conversationId] };
  if (!canReply) {
    return important ? (
      <Star aria-label="Important" className="size-4 fill-warning text-warning" />
    ) : null;
  }
  return (
    <span className="flex items-center gap-0.5" title={error ?? undefined}>
      {pending && <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />}
      {inBin ? (
        <>
          <button
            type="button"
            className={cn(iconButton, onHover)}
            aria-label="Restore"
            title="Restore"
            disabled={pending}
            onClick={() => run(() => restoreEmailAction(ids))}
          >
            <RotateCcw aria-hidden className="size-4" />
          </button>
          {canManage && (
            <button
              type="button"
              className={cn(iconButton, onHover, 'hover:text-destructive-text')}
              aria-label="Delete forever"
              title="Delete forever"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className={cn(iconButton, !important && onHover)}
            aria-label={important ? 'Not important' : 'Mark important'}
            aria-pressed={important}
            title={important ? 'Marked important' : 'Mark important'}
            disabled={pending}
            onClick={() =>
              run(() =>
                importantEmailAction({ conversationIds: [conversationId], important: !important }),
              )
            }
          >
            <Star aria-hidden className={cn('size-4', important && 'fill-warning text-warning')} />
          </button>
          <button
            type="button"
            className={cn(iconButton, onHover, 'hover:text-destructive-text')}
            aria-label="Delete"
            title="Delete (moves to the Bin)"
            disabled={pending}
            onClick={() => run(() => binEmailAction(ids))}
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </>
      )}
      {error && (
        <span className="sr-only" role="alert">
          {error}
        </span>
      )}
      <ForeverDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this email forever?"
        description="The whole thread, its messages and its files are deleted now. This cannot be undone."
        onConfirm={() => run(() => purgeEmailAction(ids))}
      />
    </span>
  );
}

/** An open thread's Important, Delete, Restore and Delete forever buttons. */
export function ThreadBinControls({
  conversationId,
  important,
  inBin,
  canManage,
  backHref,
}: {
  conversationId: string;
  important: boolean;
  inBin: boolean;
  canManage: boolean;
  /** Where to go once the thread leaves this folder. */
  backHref: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const ids = { conversationIds: [conversationId] };
  const leave = () => {
    router.push(backHref);
    router.refresh();
  };
  return (
    <>
      {inBin ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => restoreEmailAction(ids))}
          >
            <RotateCcw aria-hidden /> Restore
          </Button>
          {canManage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive-text"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              <X aria-hidden /> Delete forever
            </Button>
          )}
        </>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={important}
            disabled={pending}
            onClick={() =>
              run(() =>
                importantEmailAction({ conversationIds: [conversationId], important: !important }),
              )
            }
          >
            <Star aria-hidden className={cn(important && 'fill-warning text-warning')} />
            {important ? 'Important' : 'Mark important'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => binEmailAction(ids), leave)}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-destructive-text">
          {error}
        </p>
      )}
      <ForeverDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this email forever?"
        description="The whole thread, its messages and its files are deleted now. This cannot be undone."
        onConfirm={() => run(() => purgeEmailAction(ids), leave)}
      />
    </>
  );
}

/** Empties the Bin now (managers): everything in it, deleted for good. */
export function EmptyBinButton() {
  const { pending, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-destructive-text"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}
        Empty Bin
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive-text">
          {error}
        </span>
      )}
      <ForeverDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Empty the Bin?"
        description="Every email in the Bin, with its messages and files, is deleted now. This cannot be undone."
        onConfirm={() => run(() => emptyEmailBinAction({}))}
      />
    </>
  );
}
