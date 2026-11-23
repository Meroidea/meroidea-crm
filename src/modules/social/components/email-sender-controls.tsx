'use client';

import { Undo2, UserX } from 'lucide-react';

import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { markNotCustomerAction, moveSenderBackAction } from '@/modules/social/actions';

/**
 * An email thread from someone who is not a contact (ADR-073): set the sender aside as "Not a
 * customer" (their emails, now and later, go to Filtered), or move them back.
 */
export function EmailSenderControls({
  conversationId,
  markedNotCustomer,
}: {
  conversationId: string;
  markedNotCustomer: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col items-end gap-1">
      {markedNotCustomer ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => run(() => moveSenderBackAction({ conversationId }))}
        >
          <Undo2 aria-hidden /> Move back
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          title="Their emails, now and later, go to Filtered. You can move them back."
          onClick={() => run(() => markNotCustomerAction({ conversationId }))}
        >
          <UserX aria-hidden /> Not a customer
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
