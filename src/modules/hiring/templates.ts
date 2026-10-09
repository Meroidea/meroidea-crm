import { formatCalendarDate } from '@/lib/format';

import { EMPLOYMENT_TYPE_LABELS, type EmploymentType, type Statement } from './compliance';

export type ContractData = {
  employerName: string;
  employeeName: string;
  employmentType: EmploymentType;
  positionTitle: string;
  startDate: string;
  endDate: string | null;
  hoursPerWeek: string | null;
  payBasis: 'hourly' | 'annual';
  payRate: string;
  currency: string;
  awardName: string | null;
  awardCode: string | null;
  classification: string | null;
  contractorAbn: string | null;
  probationMonths: number | null;
  statements: Statement[];
};

const money = (amount: string, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(amount));

/**
 * Builds the wording a new hire is asked to accept, as plain paragraphs separated by blank lines
 * with "## " headings. This is starter wording, marked as such in the output: every workspace
 * must have its own contract terms reviewed before relying on them.
 */
export function renderContract(data: ContractData): string {
  const contractor = data.employmentType === 'contractor';
  const pay = `${money(data.payRate, data.currency)} ${data.payBasis === 'hourly' ? 'per hour' : 'per year'}`;
  const sections: [string, string[]][] = [];

  sections.push([
    contractor ? 'Contractor agreement' : 'Letter of offer and employment contract',
    [
      `Between ${data.employerName} ("we", "us") and ${data.employeeName} ("you").`,
      contractor
        ? `We engage you as an independent contractor to provide services as ${data.positionTitle}. You are not our employee.`
        : `We are pleased to offer you ${EMPLOYMENT_TYPE_LABELS[data.employmentType].toLowerCase()} employment in the position of ${data.positionTitle}.`,
    ],
  ]);

  const term = [
    `This ${contractor ? 'engagement' : 'employment'} starts on ${formatCalendarDate(data.startDate)}.`,
  ];
  if (data.endDate) {
    term.push(
      `It ends on ${formatCalendarDate(data.endDate)} unless ended earlier in line with this agreement.`,
    );
  } else if (data.employmentType === 'casual') {
    term.push(
      'You are a casual employee. There is no firm advance commitment to continuing and indefinite work, and each engagement is separate.',
    );
  } else {
    term.push('It is ongoing until ended by either of us in line with this contract.');
  }
  if (data.probationMonths && !contractor) {
    term.push(`A probation period of ${data.probationMonths} months applies from your start date.`);
  }
  sections.push(['Term', term]);

  if (!contractor) {
    const hours =
      data.employmentType === 'casual'
        ? 'Your hours will vary and are offered as work is available. You may accept or decline any shift.'
        : `Your ordinary hours are ${data.hoursPerWeek ?? '38'} per week. We may ask you to work reasonable additional hours.`;
    sections.push(['Hours of work', [hours]]);
  }

  const payLines = [
    contractor
      ? `We will pay you ${pay}, on receipt of a valid tax invoice quoting ABN ${data.contractorAbn ?? ''}. You are responsible for your own tax, superannuation and insurance.`
      : `You will be paid ${pay}, before tax.`,
  ];
  if (!contractor) {
    payLines.push(
      data.employmentType === 'casual'
        ? 'This rate includes a casual loading paid instead of entitlements such as paid annual leave and paid personal leave.'
        : 'We will make superannuation contributions for you as required by law.',
    );
  }
  sections.push([contractor ? 'Fees' : 'Pay', payLines]);

  if (!contractor) {
    sections.push([
      'Award and minimum conditions',
      [
        data.awardName
          ? `Your employment is covered by the ${data.awardName}${data.awardCode ? ` (${data.awardCode})` : ''}, classification: ${data.classification ?? 'to be confirmed'}. The award applies as varied from time to time and is not incorporated into this contract.`
          : 'No modern award is recorded as covering this position.',
        'Nothing in this contract gives you less than the National Employment Standards or any award that covers you.',
      ],
    ]);
    if (data.employmentType !== 'casual') {
      sections.push([
        'Leave',
        [
          'You are entitled to leave in line with the National Employment Standards and any award that covers you.',
        ],
      ]);
    }
    sections.push([
      'Ending employment',
      [
        data.employmentType === 'casual'
          ? 'Either of us may end your casual employment in line with the award and the law.'
          : 'Either of us may end your employment by giving the notice required by the National Employment Standards and any award that covers you.',
      ],
    ]);
  }

  if (data.statements.length > 0) {
    sections.push([
      'Statements given to you with this contract',
      data.statements.map((statement) => `${statement.title}: ${statement.url}`),
    ]);
  }

  sections.push([
    'About this wording',
    [
      'STARTER TEMPLATE. This wording was generated from a general template and has not been reviewed for your circumstances. The employer is responsible for having it checked before relying on it.',
    ],
  ]);

  return sections
    .map(([heading, paragraphs]) => [`## ${heading}`, ...paragraphs].join('\n\n'))
    .join('\n\n');
}
