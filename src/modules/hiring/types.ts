import type { EmploymentType, Statement } from './compliance';

export type ContractStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'withdrawn';

export type EmployeeListRow = {
  id: string;
  fullName: string;
  email: string;
  status: 'pending' | 'active' | 'ended';
  contractId: string | null;
  contractStatus: ContractStatus | null;
  employmentType: EmploymentType | null;
  positionTitle: string | null;
  startDate: string | null;
};

export type ContractDetail = {
  id: string;
  status: ContractStatus;
  employmentType: EmploymentType;
  positionTitle: string;
  startDate: string;
  endDate: string | null;
  hoursPerWeek: string | null;
  payBasis: 'hourly' | 'annual';
  payRate: string;
  currency: string;
  awardCode: string | null;
  awardName: string | null;
  classification: string | null;
  minimumRate: string | null;
  rateSource: 'fair_work' | 'manual' | 'none';
  belowMinimumReason: string | null;
  contractorAbn: string | null;
  probationMonths: number | null;
  /** The frozen wording once sent; a preview rendered from current terms while a draft. */
  body: string;
  statements: Statement[];
  sentAt: Date | null;
  viewedAt: Date | null;
  acceptedAt: Date | null;
  acceptedName: string | null;
  declinedAt: Date | null;
  tokenExpiresAt: Date | null;
};

export type PayrollSummary = {
  submittedAt: Date;
  hasTaxFileNumber: boolean;
  bankAccountName: string | null;
  bankAccountLast3: string | null;
  superFundName: string | null;
};

export type EmployeeDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredName: string | null;
  dateOfBirth: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** The workspace login this person signs in with, when linked. */
  userId: string | null;
  endedOn: string | null;
  endReason: string | null;
  status: 'pending' | 'active' | 'ended';
  /** The latest contract, in full. */
  contract: ContractDetail | null;
  /** Every contract this person has been offered, newest first. */
  contracts: ContractSummary[];
  /** Null when not yet submitted, or when the viewer may not see payroll details at all. */
  payroll: PayrollSummary | null;
};

export type RevealedPayroll = {
  taxFileNumber: string | null;
  bankBsb: string | null;
  bankAccount: string | null;
  superMemberNumber: string | null;
};

/** What the person holding the one-time link sees. Nothing here identifies other people. */
export type PublicOffer = {
  status: 'sent' | 'accepted' | 'declined';
  employerName: string;
  /** The employer's timezone, for showing when the offer was accepted. */
  timezone: string;
  firstName: string;
  employmentType: EmploymentType;
  positionTitle: string;
  body: string;
  statements: Statement[];
  acceptedAt: Date | null;
  /** Tax, bank and super details are still wanted from this person. */
  payrollWanted: boolean;
  payrollReceived: boolean;
  /** False when this system has no encryption key, so the details cannot be taken yet. */
  payrollAvailable: boolean;
};

export type ContractSummary = {
  id: string;
  status: ContractStatus;
  employmentType: EmploymentType;
  positionTitle: string;
  startDate: string;
  createdAt: Date;
};

export type StaffRow = {
  id: string;
  /** Preferred name when there is one, otherwise first and last. */
  displayName: string;
  email: string;
  status: 'pending' | 'active' | 'ended';
  departmentId: string | null;
  positionTitle: string | null;
  employmentType: EmploymentType | null;
  contractStatus: ContractStatus | null;
  startDate: string | null;
};

export type DepartmentRow = { id: string; name: string; headcount: number };
