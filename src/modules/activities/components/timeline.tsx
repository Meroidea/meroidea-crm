import {
  ArrowRightLeft,
  CheckCircle2,
  GitMerge,
  Inbox,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  PlusCircle,
  Send,
  ShieldCheck,
  StickyNote,
  Tag,
  Trophy,
  Undo2,
  Upload,
  UserRoundCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { formatDateTime, formatRelative } from '@/lib/format';
import type { TimelineItem } from '@/modules/activities/types';

const ICONS: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  message: MessageSquare,
  note: StickyNote,
  stage_changed: ArrowRightLeft,
  owner_changed: UserRoundCog,
  created: PlusCircle,
  task_completed: CheckCircle2,
  imported: Upload,
  status_changed: Tag,
  assigned: UserRoundCog,
  handover: Send,
  handover_accepted: CheckCircle2,
  handover_rejected: Undo2,
  converted: Trophy,
  merged: GitMerge,
  approval: ShieldCheck,
  enquiry: Inbox,
  field_changed: Pencil,
};

const INTERACTIONS = new Set(['call', 'email', 'meeting', 'message', 'note']);

const OUTCOMES: Record<string, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  left_voicemail: 'Left voicemail',
  busy: 'Busy',
};

function title(item: TimelineItem): string {
  if (!INTERACTIONS.has(item.type)) {
    const subject = item.subject ?? 'Update';
    return item.actorName && item.type === 'field_changed'
      ? `${item.actorName}: ${subject}`
      : subject;
  }
  const who = item.actorName ?? 'Someone';
  const verb: Record<string, string> = {
    call: item.direction === 'inbound' ? 'received a call' : 'logged a call',
    email: item.direction === 'inbound' ? 'received an email' : 'sent an email',
    meeting: 'had a meeting',
    message: 'logged a message',
    note: 'added a note',
  };
  return `${who} ${verb[item.type] ?? 'logged an activity'}`;
}

export function Timeline({
  items,
  timezone,
  showRecord = false,
  emptyText = 'Nothing logged yet.',
}: {
  items: TimelineItem[];
  timezone: string;
  showRecord?: boolean;
  emptyText?: string;
}) {
  if (items.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const zoned = { tenant: { timezone } };

  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
      {items.map((item) => {
        const Icon = ICONS[item.type] ?? StickyNote;
        const interaction = INTERACTIONS.has(item.type);
        return (
          <li key={item.id} className="relative flex gap-3">
            <span
              className={`z-[1] flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card ${
                interaction ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium">{title(item)}</p>
                <time
                  dateTime={new Date(item.occurredAt).toISOString()}
                  title={formatDateTime(zoned, item.occurredAt)}
                  className="text-xs text-muted-foreground"
                >
                  {formatRelative(item.occurredAt)}
                </time>
              </div>
              {showRecord && (item.opportunityName || item.contactName) && (
                <p className="text-xs text-muted-foreground">
                  {item.opportunityId ? (
                    <Link
                      href={`/opportunities/${item.opportunityId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {item.opportunityName}
                    </Link>
                  ) : item.contactId ? (
                    <Link
                      href={`/contacts/${item.contactId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {item.contactName}
                    </Link>
                  ) : null}
                </p>
              )}
              {INTERACTIONS.has(item.type) && item.subject && (
                <p className="mt-0.5 text-sm text-muted-foreground">{item.subject}</p>
              )}
              {item.outcome && (
                <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {OUTCOMES[item.outcome] ?? item.outcome}
                </span>
              )}
              {item.body && (
                <p className="mt-1 rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">
                  {item.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
