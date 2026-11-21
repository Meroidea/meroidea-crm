import { Mail, Phone } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

import { AssignSelect, SnoozeControl } from './conversation-controls';
import { CustomerAvatar, PlatformBadge } from './platform-badge';
import { ReplyWindowBadge } from './reply-window';
import { ContactLinker, StatusButton } from './social-tools';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The conversation's third pane (ADR-067): who the customer is on the platform and in the CRM,
 * the reply window, who looks after it, and its status. A server component; the controls in it
 * are client components calling the inbox's actions.
 */
export function ConversationDetails(props: {
  conversationId: string;
  name: string;
  hasPicture: boolean;
  platform: Parameters<typeof PlatformBadge>[0]['platform'];
  handle: string | null;
  phone: string | null;
  accountName: string;
  accountBadge: string | null;
  window: { normal: string | null; human: string | null };
  status: string;
  snoozedLabel: string | null;
  snoozeOptions: { label: string; until: string }[];
  assignedUserId: string | null;
  members: { userId: string; fullName: string }[];
  myUserId: string;
  canReply: boolean;
  contact: {
    label: string;
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    canLink: boolean;
  };
}) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Customer">
        <div className="flex items-center gap-3">
          <CustomerAvatar
            conversationId={props.conversationId}
            name={props.name}
            hasPicture={props.hasPicture}
            className="size-10 text-sm"
          />
          <div className="min-w-0">
            <p className="truncate font-medium" data-sensitive>
              {props.name}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <PlatformBadge platform={props.platform} />
              {props.handle && <span data-sensitive>@{props.handle}</span>}
            </div>
          </div>
        </div>
        {props.phone && (
          <p className="flex items-center gap-1.5 text-sm" data-sensitive>
            <Phone aria-hidden className="size-3.5 text-muted-foreground" /> +{props.phone}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Writing to {props.accountName}{' '}
          {props.accountBadge && <Badge variant="destructive">{props.accountBadge}</Badge>}
        </p>
        <ReplyWindowBadge normalEndsAt={props.window.normal} humanEndsAt={props.window.human} />
      </Section>

      {props.contact.canLink && (
        <Section title={`Linked ${props.contact.label.toLowerCase()}`}>
          <ContactLinker
            conversationId={props.conversationId}
            contactId={props.contact.id}
            contactName={props.contact.name}
            contactLabel={props.contact.label}
          />
          {props.contact.email && (
            <p className="flex items-center gap-1.5 text-sm" data-sensitive>
              <Mail aria-hidden className="size-3.5 text-muted-foreground" /> {props.contact.email}
            </p>
          )}
          {props.contact.phone && (
            <p className="flex items-center gap-1.5 text-sm" data-sensitive>
              <Phone aria-hidden className="size-3.5 text-muted-foreground" /> {props.contact.phone}
            </p>
          )}
        </Section>
      )}

      {props.canReply && (
        <>
          <Section title="Assignment">
            <AssignSelect
              conversationId={props.conversationId}
              assignedUserId={props.assignedUserId}
              members={props.members}
              myUserId={props.myUserId}
            />
          </Section>
          <Section title="Status">
            <StatusButton conversationId={props.conversationId} status={props.status} />
            <SnoozeControl
              conversationId={props.conversationId}
              snoozedLabel={props.snoozedLabel}
              options={props.snoozeOptions}
            />
          </Section>
        </>
      )}
    </div>
  );
}
