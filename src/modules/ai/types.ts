/**
 * What the assistant returns (ADR-074). Every artifact is a preview: nothing in it has been saved
 * or sent. The person approves it in the drawer, and only then does an ordinary module service
 * save it, re-validating everything as if they had typed it themselves.
 */

export type ToolName =
  | 'create_draft_invoice'
  | 'generate_staff_roster'
  | 'remove_roster_shifts'
  | 'delete_roster'
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
  /** Why nobody could take it, when it is vacant (ADR-079). */
  vacantReason?: 'no_one_in_team' | 'hours_cap' | 'nobody_free';
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
  /**
   * Where the shifts came from: the person's request, the trading hours, last week, the last
   * four weeks' pattern, or a roster the person chose to copy.
   */
  source?: 'request' | 'trading_hours' | 'last_week' | 'patterns' | 'copy';
  /** Against the trading hours' staff numbers; null when no trading hours are set. */
  coverage?: {
    neededMinutes: number;
    plannedMinutes: number;
    gaps: { date: string; from: string; to: string; short: number }[];
  } | null;
  /** Shifts already in the period that approving removes first (ADR-079). */
  replaces?: string[];
  /** Whether contracted hours were offered first. */
  contractedFirst?: boolean;
  /** How MeroAI read the manager's notes, in words, for the person to check. */
  notesApplied?: string[];
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
  | RemoveShiftsArtifact
  | DeleteRosterArtifact
  | CommunicationDraftArtifact
  | DocumentSummaryArtifact
  | NextActionsArtifact;

export type AssistantResponse = {
  reply: string;
  actionTaken: ToolName | null;
  artifact: AssistantArtifact | null;
};

/** Who could take each vacant shift (ADR-079): proposed, not saved, until the manager approves. */
export type FillVacantArtifact = {
  kind: 'fill_vacant';
  rosterId: string;
  vacant: number;
  assignments: {
    shiftId: string;
    userId: string;
    personName: string;
    teamName: string | null;
    date: string;
    startTime: string;
    endTime: string;
  }[];
  warnings: string[];
};

/** Shifts the roster agent proposes to remove, for the manager to confirm. */
export type RemoveShiftsArtifact = {
  kind: 'remove_shifts';
  rosterId: string;
  shiftIds: string[];
  /** "All 33 shifts", "Sam Lee's 4 shifts": what the manager is confirming. */
  description: string;
  shifts: { date: string; startTime: string; endTime: string; personName: string | null }[];
};

/** A whole roster the manager is asked to confirm deleting, with all its shifts. */
export type DeleteRosterArtifact = {
  kind: 'delete_roster';
  rosterId: string;
  startsOn: string;
  endsOn: string;
  shifts: number;
  /** Staff have been shown it, so deleting takes shifts away they know about. */
  published: boolean;
};

/** One shift the roster agent proposes to give to someone else, or leave vacant. */
export type ChangeShiftArtifact = {
  kind: 'change_shift';
  shiftId: string;
  date: string;
  startTime: string;
  endTime: string;
  fromName: string | null;
  toUserId: string | null;
  toName: string | null;
};

/** What the roster agent can put in front of the manager. */
export type RosterAgentArtifact =
  | RosterPreviewArtifact
  | FillVacantArtifact
  | RemoveShiftsArtifact
  | DeleteRosterArtifact
  | ChangeShiftArtifact;

/** The roster agent's check after a change: what still needs the manager. */
export type RosterCheck = {
  rosterId: string;
  startsOn: string;
  endsOn: string;
  shifts: number;
  vacant: number;
  rosteredMinutes: number;
  /** Person-minutes the trading hours ask for; null when none are set. */
  neededMinutes: number | null;
  gaps: { date: string; from: string; to: string; short: number }[];
  onLeave: number;
  /** In words, most important first. Empty when nothing needs attention. */
  findings: string[];
};

export type RosterApprovalResult = {
  saved: number;
  /** Shifts removed first because the plan replaced them. */
  removed: number;
  /** The rosters the shifts went onto. */
  rosterIds: string[];
  skipped: { date: string; startTime: string; personName: string | null; reason: string }[];
  /** Where to open the roster afterwards. */
  firstDate: string | null;
};
