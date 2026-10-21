/*
 * The two example businesses and the people hired into each. Everything here is fictional:
 * names, phone numbers (ACMA's 02 5550 xxxx range is reserved for fiction) and payroll details.
 * Staff emails are Gmail plus-aliases of the business admin's own inbox, so every email the
 * app sends lands with the person running the demo.
 *
 * Pay is never written here. Each award-covered role names its award and classification; the
 * hire script reads that classification's minimum from the Fair Work pay database and pays a
 * stated margin above it.
 */

import type { BusinessTypeKey } from '@/lib/features';

export type DemoBusiness = {
  companyName: string;
  legalName: string;
  /** Passes the app's ABN checksum; an example, not a registered business. */
  businessNumber: string;
  businessType: BusinessTypeKey;
  adminName: string;
  adminEmail: string;
  primaryContactPhone: string;
  /** For the runbook only: the app stores the location as coordinates, not an address. */
  address: string;
  latitude: string;
  longitude: string;
  radiusMetres: number;
  departments: string[];
};

export const SYDNEY_CAFE: DemoBusiness = {
  companyName: 'Sydney Cafe & Restaurant',
  legalName: 'Sydney Cafe & Restaurant Pty Ltd',
  // The checksum-valid example ABN the app's own tests use.
  businessNumber: '51 824 753 556',
  businessType: 'restaurant',
  adminName: 'Sujan Darji',
  adminEmail: 'sujan.contact.214@gmail.com',
  primaryContactPhone: '02 5550 0101',
  address: '388 George Street, Sydney NSW 2000',
  latitude: '-33.868820',
  longitude: '151.207030',
  radiusMetres: 100,
  departments: ['Front of house', 'Kitchen', 'Barista'],
};

export const BURWOOD_CONSULTANCY: DemoBusiness = {
  companyName: 'Burwood Educational Consultancy',
  legalName: 'Burwood Educational Consultancy Pty Ltd',
  // Generated to pass the modulus-89 check (check digits 18 + body 123456789); not registered.
  businessNumber: '18 123 456 789',
  businessType: 'consultancy',
  adminName: 'Sujan Darji',
  adminEmail: 'burwood2801@gmail.com',
  primaryContactPhone: '02 5550 0202',
  address: '160 Burwood Road, Burwood NSW 2134',
  latitude: '-33.877380',
  longitude: '151.103870',
  radiusMetres: 100,
  departments: ['Admissions', 'Visa services', 'Student support'],
};

export const DEMO_BUSINESSES: DemoBusiness[] = [SYDNEY_CAFE, BURWOOD_CONSULTANCY];

/** Awards by the name searched in the pay database and the code the result must carry. */
export const AWARDS = {
  restaurant: { search: 'Restaurant Industry Award', code: 'MA000119' },
  clerks: { search: 'Clerks', code: 'MA000002' },
} as const;
export type AwardKey = keyof typeof AWARDS;

/**
 * How a role's pay is set.
 * - `award`: the classification is the one adult classification whose label matches `match`.
 * - `award_free`: no award applies (a professional role). The salary is set a margin above a
 *   reference classification read from the pay database, which is far above the national
 *   minimum wage. The reference is used only to size the salary; no award is recorded.
 */
export type PaySpec =
  | { kind: 'award'; award: AwardKey; match: RegExp; marginPercent: number }
  | { kind: 'award_free'; reference: { award: AwardKey; match: RegExp }; marginPercent: number };

export type DemoHire = {
  firstName: string;
  lastName: string;
  /** Local part of the plus-alias, e.g. "maria.lopez". */
  alias: string;
  positionTitle: string;
  department: string;
  login: 'manager' | 'member';
  employmentType: 'full_time' | 'part_time' | 'casual';
  /** Full-time is 38; part-time agreed hours; casual has none. */
  hoursPerWeek: string | null;
  payBasis: 'hourly' | 'annual';
  pay: PaySpec;
};

// Restaurant Industry Award 2020 labels read "Adult: Level 4 — Food and beverage attendant
// grade 4 (tradesperson); Cook grade 3 (tradesperson); …", so roles match on the grade.
const restaurant = (grade: string, marginPercent: number): PaySpec => ({
  kind: 'award',
  award: 'restaurant',
  match: new RegExp(`^Adult: .*\\b${grade}\\b`),
  marginPercent,
});

// Clerks – Private Sector Award 2020 labels read "Adult: Level 1—Year 2", "Adult: Level 3".
const clerksLevel = (level: string) => new RegExp(`^Adult: Level ${level}(?![0-9])`);
const clerks = (level: string, marginPercent: number): PaySpec => ({
  kind: 'award',
  award: 'clerks',
  match: clerksLevel(level),
  marginPercent,
});

export const CAFE_HIRES: DemoHire[] = [
  {
    firstName: 'Maria',
    lastName: 'Lopez',
    alias: 'maria.lopez',
    positionTitle: 'Restaurant Manager',
    department: 'Front of house',
    login: 'manager',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'annual',
    // The award's most senior food and beverage grade, which supervises the floor.
    pay: restaurant('Food and beverage attendant grade 4', 25),
  },
  {
    firstName: 'Hiroshi',
    lastName: 'Tanaka',
    alias: 'hiroshi.tanaka',
    positionTitle: 'Head Chef',
    department: 'Kitchen',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'annual',
    pay: restaurant('Cook grade 5', 20),
  },
  {
    firstName: 'Priya',
    lastName: 'Sharma',
    alias: 'priya.sharma',
    positionTitle: 'Cook',
    department: 'Kitchen',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'hourly',
    pay: restaurant('Cook grade 3', 10),
  },
  {
    firstName: 'Liam',
    lastName: 'Murphy',
    alias: 'liam.murphy',
    positionTitle: 'Cook',
    department: 'Kitchen',
    login: 'member',
    employmentType: 'part_time',
    hoursPerWeek: '25',
    payBasis: 'hourly',
    pay: restaurant('Cook grade 2', 10),
  },
  {
    firstName: 'Fatima',
    lastName: 'Haddad',
    alias: 'fatima.haddad',
    positionTitle: 'Kitchen Hand',
    department: 'Kitchen',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: restaurant('Kitchen attendant grade 1', 5),
  },
  {
    firstName: 'An',
    lastName: 'Nguyen',
    alias: 'an.nguyen',
    positionTitle: 'Kitchen Hand',
    department: 'Kitchen',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: restaurant('Kitchen attendant grade 1', 5),
  },
  {
    firstName: 'Sofia',
    lastName: 'Rossi',
    alias: 'sofia.rossi',
    positionTitle: 'Senior Barista',
    department: 'Barista',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'hourly',
    pay: restaurant('Food and beverage attendant grade 3', 10),
  },
  {
    firstName: 'Kwame',
    lastName: 'Mensah',
    alias: 'kwame.mensah',
    positionTitle: 'Barista',
    department: 'Barista',
    login: 'member',
    employmentType: 'part_time',
    hoursPerWeek: '24',
    payBasis: 'hourly',
    pay: restaurant('Food and beverage attendant grade 2', 8),
  },
  {
    firstName: 'Chloe',
    lastName: 'Martin',
    alias: 'chloe.martin',
    positionTitle: 'Waiter',
    department: 'Front of house',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: restaurant('Food and beverage attendant grade 1', 5),
  },
  {
    firstName: 'Arjun',
    lastName: 'Patel',
    alias: 'arjun.patel',
    positionTitle: 'Waiter',
    department: 'Front of house',
    login: 'member',
    employmentType: 'part_time',
    hoursPerWeek: '20',
    payBasis: 'hourly',
    pay: restaurant('Food and beverage attendant grade 2', 8),
  },
  {
    firstName: 'Mei',
    lastName: 'Chen',
    alias: 'mei.chen',
    positionTitle: 'Host',
    department: 'Front of house',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: restaurant('Food and beverage attendant grade 1', 5),
  },
];

const COUNSELLOR_REFERENCE = { award: 'clerks', match: clerksLevel('5') } as const;

export const CONSULTANCY_HIRES: DemoHire[] = [
  {
    firstName: 'Daniel',
    lastName: 'Kim',
    alias: 'daniel.kim',
    positionTitle: 'Office Manager',
    department: 'Admissions',
    login: 'manager',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'annual',
    pay: clerks('5', 20),
  },
  {
    firstName: 'Aisha',
    lastName: 'Rahman',
    alias: 'aisha.rahman',
    positionTitle: 'Senior Education Counsellor',
    department: 'Admissions',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'annual',
    pay: { kind: 'award_free', reference: COUNSELLOR_REFERENCE, marginPercent: 30 },
  },
  {
    firstName: 'Tom',
    lastName: 'Becker',
    alias: 'tom.becker',
    positionTitle: 'Education Counsellor',
    department: 'Admissions',
    login: 'member',
    employmentType: 'part_time',
    hoursPerWeek: '30',
    payBasis: 'annual',
    pay: { kind: 'award_free', reference: COUNSELLOR_REFERENCE, marginPercent: 20 },
  },
  {
    firstName: 'Lucia',
    lastName: 'Fernandes',
    alias: 'lucia.fernandes',
    positionTitle: 'Admissions Officer',
    department: 'Admissions',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'hourly',
    pay: clerks('3', 10),
  },
  {
    firstName: 'Omar',
    lastName: 'Farouk',
    alias: 'omar.farouk',
    positionTitle: 'Visa Case Officer',
    department: 'Visa services',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'hourly',
    pay: clerks('4', 10),
  },
  {
    firstName: 'Grace',
    lastName: 'Okafor',
    alias: 'grace.okafor',
    positionTitle: 'Visa Case Officer',
    department: 'Visa services',
    login: 'member',
    employmentType: 'part_time',
    hoursPerWeek: '24',
    payBasis: 'hourly',
    pay: clerks('4', 10),
  },
  {
    firstName: 'Ethan',
    lastName: 'Walker',
    alias: 'ethan.walker',
    positionTitle: 'Visa Documentation Assistant',
    department: 'Visa services',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: clerks('2', 5),
  },
  {
    firstName: 'Jiwoo',
    lastName: 'Park',
    alias: 'jiwoo.park',
    positionTitle: 'Receptionist',
    department: 'Student support',
    login: 'member',
    employmentType: 'part_time',
    hoursPerWeek: '20',
    payBasis: 'hourly',
    pay: clerks('2', 8),
  },
  {
    firstName: 'Hannah',
    lastName: 'Schmidt',
    alias: 'hannah.schmidt',
    positionTitle: 'Student Support Officer',
    department: 'Student support',
    login: 'member',
    employmentType: 'full_time',
    hoursPerWeek: '38',
    payBasis: 'hourly',
    pay: clerks('3', 8),
  },
  {
    firstName: 'Rafael',
    lastName: 'Costa',
    alias: 'rafael.costa',
    positionTitle: 'Student Support Officer',
    department: 'Student support',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: clerks('3', 5),
  },
  {
    firstName: 'Amara',
    lastName: 'Nwosu',
    alias: 'amara.nwosu',
    positionTitle: 'Receptionist',
    department: 'Student support',
    login: 'member',
    employmentType: 'casual',
    hoursPerWeek: null,
    payBasis: 'hourly',
    pay: clerks('2', 5),
  },
];

export const HIRES_BY_BUSINESS: Record<string, DemoHire[]> = {
  [SYDNEY_CAFE.companyName]: CAFE_HIRES,
  [BURWOOD_CONSULTANCY.companyName]: CONSULTANCY_HIRES,
};

/** "sujan.contact.214@gmail.com" + "maria.lopez" → "sujan.contact.214+maria.lopez@gmail.com". */
export function plusAlias(adminEmail: string, alias: string): string {
  const [local, domain] = adminEmail.split('@');
  return `${local}+${alias}@${domain}`;
}

/**
 * Clearly synthetic payroll details, as the new hire would type them on the offer page.
 * - Tax file number left blank, which the form allows (someone may not have one yet).
 * - BSB 000-000 and account 00000000 pass the app's format checks and belong to no bank.
 */
export function demoPayroll(token: string, fullName: string) {
  return {
    token,
    taxFileNumber: '',
    taxResident: 'yes',
    claimsTaxFreeThreshold: 'yes',
    hasStudyLoan: 'no',
    bankAccountName: `${fullName} (demo data)`,
    bankBsb: '000-000',
    bankAccount: '00000000',
    superFundName: 'Example Super Fund (demo)',
    superFundUsi: '',
    superMemberNumber: '',
  };
}
