export type TimelineItem = {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  direction: 'inbound' | 'outbound' | null;
  occurredAt: Date;
  actorName: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  /** Where to read the whole thing, for items kept elsewhere (an inbox conversation). */
  href?: string | null;
  /** The words of that link; "Open the conversation" when not given. */
  hrefLabel?: string;
};
