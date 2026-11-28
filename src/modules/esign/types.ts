import type { Box, FieldKind } from './geometry';

export type SignRequestStatus = 'draft' | 'sent' | 'completed' | 'declined' | 'voided';
export type SignerStatus = 'pending' | 'signed' | 'declined';
export type SigningOrder = 'parallel' | 'sequential';

export type SignRequestRow = {
  id: string;
  title: string;
  status: SignRequestStatus;
  /** True for a sent request whose time has run out. */
  expired: boolean;
  documentName: string;
  signerCount: number;
  signedCount: number;
  createdAt: Date;
  sentAt: Date | null;
  completedAt: Date | null;
};

export type SignerView = {
  id: string;
  position: number;
  name: string;
  email: string;
  status: SignerStatus;
  invitedAt: Date | null;
  verifiedAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  declineReason: string | null;
};

export type FieldView = Box & {
  id: string;
  signerId: string;
  kind: FieldKind;
  page: number;
  required: boolean;
  label: string | null;
  filled: boolean;
};

export type EventView = {
  id: string;
  event: string;
  signerName: string | null;
  actorName: string | null;
  createdAt: Date;
};

export type SignRequestDetail = {
  id: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  title: string;
  message: string | null;
  status: SignRequestStatus;
  expired: boolean;
  signingOrder: SigningOrder;
  verifyEmail: boolean;
  expiryDays: number | null;
  expiresAt: Date | null;
  pageCount: number | null;
  originalSha256: string | null;
  signedSha256: string | null;
  sentAt: Date | null;
  sentByName: string | null;
  completedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  signers: SignerView[];
  fields: FieldView[];
  events: EventView[];
};

/** What the signer's page needs. Nothing here identifies other signers beyond a first name. */
export type SigningView = {
  businessName: string;
  timezone: string;
  title: string;
  message: string | null;
  senderName: string;
  signerName: string;
  /** j•••@example.com, so they can tell which inbox to check. */
  maskedEmail: string;
  requestStatus: SignRequestStatus;
  expired: boolean;
  expiresAt: Date | null;
  signerStatus: SignerStatus;
  signedAt: Date | null;
  needsCode: boolean;
  /** Who must sign first, when the request is in order and it is not this signer's turn. */
  waitingFor: string | null;
  pageCount: number;
  /** Only once the signer may see the document. */
  fields: (Box & {
    id: string;
    kind: FieldKind;
    page: number;
    required: boolean;
    label: string | null;
  })[];
  progress: { signed: number; total: number };
};
