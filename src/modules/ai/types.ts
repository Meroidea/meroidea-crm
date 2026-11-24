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

export type RosterPreviewArtifact = {
  kind: 'roster_preview';
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
