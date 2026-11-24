/**
 * What the assistant returns (ADR-074). Every artifact is a preview: nothing in it has been saved
 * or sent. The person approves it in the drawer, and only then does an ordinary module service
 * save it, re-validating everything as if they had typed it themselves.
 */

export type ToolName =
  | 'create_draft_invoice'
  | 'generate_staff_roster'
  | 'draft_communication'
  | 'analyse_document'
  | 'suggest_next_actions';

export type InvoiceDraftArtifact = {
  kind: 'invoice_draft';
  customer: {
    name: string;
    email: string | null;
    address: string | null;
    /** The contact it was matched to, or null when only a name was given. */
    contactId: string | null;
  };
  issueDate: string;
  dueDate: string;
  taxRate: string;
  currency: string;
  fromDetails: string | null;
  notes: string | null;
  lines: { description: string; quantity: string; unitPrice: string; lineTotal: string }[];
  subtotal: string;
  taxTotal: string;
  total: string;
  warnings: string[];
};

export type RosterPreviewShift = {
  date: string;
  startTime: string;
  endTime: string;
  userId: string | null;
  personName: string | null;
  teamId: string | null;
  teamName: string | null;
  breaks: { minutes: number; paid: boolean }[];
  paidMinutes: number;
  note: string | null;
};

/** MeroAI's ways of building a roster (ADR-076). */
export const ROSTER_STRATEGIES = [
  'copy_last_week',
  'lowest_cost',
  'most_productive',
  'even_hours',
] as const;
export type RosterStrategy = (typeof ROSTER_STRATEGIES)[number];

export const ROSTER_STRATEGY_TEXT: Record<RosterStrategy, { title: string; description: string }> =
  {
    copy_last_week: {
      title: 'Copy last week',
      description:
        'The same shifts with the same people. Anyone now away is swapped for someone free.',
    },
    lowest_cost: {
      title: 'Lowest wage cost',
      description:
        'Covers your trading hours with the cheapest available person for each shift, loadings included.',
    },
    most_productive: {
      title: 'Most productive',
      description:
        'Puts your most reliable people on first: hours actually worked and tasks done on time, last 4 weeks.',
    },
    even_hours: {
      title: 'Even hours',
      description: 'Covers your trading hours and shares the hours out fairly across the team.',
    },
  };

export type RosterPreviewArtifact = {
  kind: 'roster_preview';
  /** How it was built; absent for previews from before strategies existed. */
  strategy?: RosterStrategy;
  /** Where the shifts came from: the person's request, the trading hours, or last week. */
  source?: 'request' | 'trading_hours' | 'last_week';
  /** What the rostered shifts would cost, where the viewer may see pay; null otherwise. */
  estimatedCost?: { total: string; currency: string; unpriced: number } | null;
  startsOn: string;
  endsOn: string;
  shifts: RosterPreviewShift[];
  people: {
    userId: string;
    name: string;
    newShifts: number;
    newMinutes: number;
    existingMinutes: number;
  }[];
  unfilled: number;
  warnings: string[];
};

export type CommunicationChannel = 'email' | 'sms' | 'note';

export type CommunicationDraftArtifact = {
  kind: 'communication_draft';
  contactId: string;
  contactName: string;
  channel: CommunicationChannel;
  intent: string;
  /** Null for a text message or a note. */
  subject: string | null;
  body: string;
  /** From the contact's record, for the "open in email / messages" link; never from the model. */
  recipient: { email: string | null; phone: string | null };
};

export type DocumentSummaryArtifact = {
  kind: 'document_summary';
  fileName: string;
  summary: string;
  keyDates: { date: string | null; label: string; description: string }[];
  actionItems: string[];
  risksOrFlags: { severity: 'high' | 'medium' | 'low'; description: string }[];
};

export type NextAction = {
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  /** The record to open, built from data the person can see; never a link the model wrote. */
  href: string | null;
  recordLabel: string | null;
};

export type NextActionsArtifact = { kind: 'next_actions'; actions: NextAction[] };

export type AssistantArtifact =
  | InvoiceDraftArtifact
  | RosterPreviewArtifact
  | CommunicationDraftArtifact
  | DocumentSummaryArtifact
  | NextActionsArtifact;

export type AssistantResponse = {
  reply: string;
  actionTaken: ToolName | null;
  artifact: AssistantArtifact | null;
};

export type RosterApprovalResult = {
  saved: number;
  skipped: { date: string; startTime: string; personName: string | null; reason: string }[];
  /** Where to open the roster afterwards. */
  firstDate: string | null;
};
