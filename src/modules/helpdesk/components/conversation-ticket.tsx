'use client';

import { LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTicketFromConversationAction } from '@/modules/helpdesk/actions';

import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Priority,
  type TicketStatus,
} from '../schemas';

/**
 * The helpdesk side of an inbox conversation (ADR-069): the tickets that follow it, or making
 * one for the customer, their organization and open opportunities.
 */
export function ConversationTicket({
  conversationId,
  tickets,
  defaultSubject,
}: {
  conversationId: string;
  tickets: { id: string; number: number; status: TicketStatus }[];
  defaultSubject: string;
}) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [priority, setPriority] = useState<Priority>('normal');
  const active = tickets.some((ticket) => ['open', 'pending', 'on_hold'].includes(ticket.status));
  return (
    <div className="flex flex-col gap-2 text-sm">
      {tickets.length > 0 && (
        <ul className="flex flex-col gap-1">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="flex items-center justify-between gap-2">
              <Link
                href={`/helpdesk/${ticket.id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Ticket #{ticket.number}
              </Link>
              <Badge variant="outline">{STATUS_LABELS[ticket.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {!active &&
        (open ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => createTicketFromConversationAction({ conversationId, subject, priority }),
                (data) => router.push(`/helpdesk/${data.id}`),
              );
            }}
          >
            <Input
              aria-label="Ticket subject"
              value={subject}
              maxLength={160}
              required
              onChange={(event) => setSubject(event.target.value)}
            />
            <NativeSelect
              aria-label="Priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {PRIORITY_LABELS[option]} priority
                </option>
              ))}
            </NativeSelect>
            <div className="flex gap-1.5">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? 'Creating…' : 'Create ticket'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
            <LifeBuoy aria-hidden /> Make it a ticket
          </Button>
        ))}
      <ErrorNote error={error} />
    </div>
  );
}
