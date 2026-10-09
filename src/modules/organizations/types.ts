export type OrganizationListRow = {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  contactCount: number;
  createdAt: Date;
};

export type OrganizationContact = {
  linkId: string;
  contactId: string;
  fullName: string;
  email: string | null;
  relationship: string;
};

export type OrganizationDetail = {
  id: string;
  name: string;
  type: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only the linked contacts the viewer's contacts.view scope covers. */
  contacts: OrganizationContact[];
  hiddenContactCount: number;
};
