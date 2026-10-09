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
};

export type DuplicateMatch = {
  matchKind: 'email' | 'phone' | 'name_dob';
  ownerName: string | null;
  /** Present only when the viewer may open the record; otherwise just who owns it. */
  contact: { id: string } | null;
};
