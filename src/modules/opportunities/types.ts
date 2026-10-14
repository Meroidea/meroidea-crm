import type { StageCategory } from '@/modules/pipelines/queries';

export type OpportunityStatus = 'open' | 'won' | 'lost';

export type OpportunityRow = {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  stageId: string;
  stageName: string;
  stageColor: string | null;
  status: OpportunityStatus;
  amount: string | null;
  currency: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  stageEnteredAt: Date;
  lastActivityAt: Date | null;
  nextTaskDueAt: Date | null;
  expectedCloseDate: string | null;
  createdAt: Date;
};

export type BoardCard = OpportunityRow & { isStale: boolean; daysInStage: number };

export type BoardColumn = {
  stageId: string;
  name: string;
  category: StageCategory;
  color: string | null;
  count: number;
  total: string;
  cards: BoardCard[];
};

export type StageVisit = {
  stageId: string;
  stageName: string;
  enteredAt: Date;
  exitedAt: Date | null;
  enteredByName: string | null;
};

export type OpportunityDetail = OpportunityRow & {
  pipelineId: string;
  organizationId: string | null;
  organizationName: string | null;
  sourceId: string | null;
  sourceName: string | null;
  partnerId: string | null;
  partnerName: string | null;
  lostReasonId: string | null;
  lostReasonName: string | null;
  lostReasonNote: string | null;
  closedAt: Date | null;
  canViewRevenue: boolean;
  history: StageVisit[];
  subSourceName: string | null;
  originatorName: string | null;
  product: string | null;
  /** The opportunity's own probability, else its stage's. */
  probability: number | null;
  probabilityOverridden: boolean;
  nextStep: string | null;
  checklistState: Record<string, string[]>;
  customFields: Record<string, unknown>;
  people: { linkId: string; contactId: string; name: string; role: string }[];
  pendingApproval: {
    id: string;
    stageId: string;
    stageName: string;
    requestedBy: string;
    requestedByName: string | null;
    requestedAt: Date;
    note: string | null;
  } | null;
};
