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
};
