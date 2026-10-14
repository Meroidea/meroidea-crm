import type { ContactStatus } from './schemas';

export type ContactListRow = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: ContactStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceName: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
};

export type ContactLink = {
  linkId: string;
  organizationId: string;
  organizationName: string;
  relationship: string;
  isPrimary: boolean;
};

export type ContactDetail = {
  id: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  /** Null both when empty and when the viewer lacks contacts.view_sensitive (see canViewSensitive). */
  dateOfBirth: string | null;
  canViewSensitive: boolean;
  gender: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: ContactStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceId: string | null;
  sourceName: string | null;
  marketingConsent: boolean;
  consentUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date | null;
  organizations: ContactLink[];
  /** The originator and handover recipient: responsible alongside the owner (scope checks). */
  alsoResponsible: (string | null)[];
  lead: LeadDetail | null;
  subSourceId: string | null;
  subSourceName: string | null;
  campaignName: string | null;
  utm: Record<string, string> | null;
  jobTitle: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companySize: string | null;
  industry: string | null;
  linkedinUrl: string | null;
  language: string | null;
  interest: string | null;
  doNotEmail: boolean;
  doNotCall: boolean;
  consentSource: string | null;
  customFields: Record<string, unknown>;
  anonymizedAt: Date | null;
  household: { linkId: string; contactId: string; name: string; relationship: string }[];
};

export type LeadDetail = {
  type: 'b2b' | 'b2c' | null;
  statusId: string;
  statusName: string;
  statusKind: 'new' | 'working' | 'pending_acceptance' | 'returned' | 'converted' | 'closed';
  statusColor: string | null;
  statusChangedAt: Date | null;
  reasonName: string | null;
  reasonNote: string | null;
  originatorUserId: string | null;
  originatorName: string | null;
  assignedAt: Date | null;
  firstContactedAt: Date | null;
  handoverToUserId: string | null;
  handoverToName: string | null;
  handoverAt: Date | null;
  handoverDueAt: Date | null;
  handoverMeetingAt: Date | null;
  handoverSummary: string | null;
  rejectedReasonName: string | null;
  rejectedNote: string | null;
  rejectedAt: Date | null;
  convertedAt: Date | null;
};

export type DuplicateMatch = {
  matchKind: 'email' | 'phone' | 'name_dob' | 'company_name';
  ownerName: string | null;
  /** Present only when the viewer may open the record; otherwise just who owns it. */
  contact: { id: string } | null;
};
