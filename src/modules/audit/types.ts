export type AuditEntryRow = {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorType: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  context: unknown;
  ip: string | null;
  userAgent: string | null;
};

export type AuditFacets = {
  people: { userId: string; name: string }[];
  types: string[];
};
