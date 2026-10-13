import type { AwardPayLine } from '@/modules/awards';

/**
 * The approved time of a pay period laid out as the timesheet workbook many payroll people
 * already work from: an Overview, a Details grid, hours By Team, By Shift Award Tag and
 * By Comments, then a sheet for each day and a sheet for each person. Pure: it only arranges
 * figures that have already been worked out.
 */

export type WorkbookCell = string | number | null | { value: string | number; bold: true };
export type WorkbookSheet = { name: string; rows: WorkbookCell[][] };

export type WorkbookEntry = {
  userId: string;
  fullName: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Unpaid break time. */
  breakMinutes: number;
  workedMinutes: number;
  team: string | null;
  note: string | null;
  /** Pay lines under an award with written-down rules; empty otherwise. */
  lines: AwardPayLine[];
};

export type WorkbookPerson = {
  userId: string;
  fullName: string;
  employeeId: string | null;
  age: number | null;
  /** Gross wage as a decimal string, or null when pay is not shown. */
  gross: string | null;
};

const bold = (value: string | number): WorkbookCell => ({ value, bold: true });

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const part = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...options }).format(utc(date));
/** "5 October 2026" */
const longDate = (date: string) =>
  `${part(date, { day: 'numeric' })} ${part(date, { month: 'long' })} ${part(date, { year: 'numeric' })}`;
/** "Mon, 5 Oct 2026" */
export const shortDate = (date: string) =>
  `${part(date, { weekday: 'short' })}, ${part(date, { day: 'numeric' })} ${part(date, { month: 'short' })} ${part(date, { year: 'numeric' })}`;
/** "5 October" */
const dayName = (date: string) =>
  `${part(date, { day: 'numeric' })} ${part(date, { month: 'long' })}`;

/** "17:30" → "05:30 PM" */
export function twelveHour(time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(shown).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

const hours = (minutes: number) => Number((minutes / 60).toFixed(2));
const money = (amount: string, currency: string) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(Number(amount));

/** The column a stretch of time with no award pay lines is counted under. */
export const PLAIN_HOURS = 'Hours at agreed rate';

type Columns = { hours: string[]; units: string[] };

/** What one stretch of work adds to each pay column: hours for a rate, a count for an amount. */
function amounts(entry: WorkbookEntry): { hours: Map<string, number>; units: Map<string, number> } {
  const byHours = new Map<string, number>();
  const byUnits = new Map<string, number>();
  if (entry.lines.length === 0) byHours.set(PLAIN_HOURS, entry.workedMinutes);
  for (const line of entry.lines) {
    if (line.minutes === null) {
      // A flat amount is so many of something: 2 hours of an evening amount, 1 allowance.
      const each = Math.round(Number(line.rate) * 100);
      byUnits.set(
        line.label,
        (byUnits.get(line.label) ?? 0) + (each > 0 ? Math.round(line.cents / each) : 1),
      );
    } else {
      byHours.set(line.label, (byHours.get(line.label) ?? 0) + line.minutes);
    }
  }
  return { hours: byHours, units: byUnits };
}

/** Pay columns in the order they were first paid, hours before amounts. */
function columnsOf(entries: WorkbookEntry[]): Columns {
  const found: Columns = { hours: [], units: [] };
  for (const entry of entries) {
    const each = amounts(entry);
    for (const label of each.hours.keys())
      if (!found.hours.includes(label)) found.hours.push(label);
    for (const label of each.units.keys())
      if (!found.units.includes(label)) found.units.push(label);
  }
  found.hours.sort((a, b) => a.localeCompare(b));
  found.units.sort((a, b) => a.localeCompare(b));
  return found;
}

function payCells(entries: WorkbookEntry[], columns: Columns): WorkbookCell[] {
  const totals = { hours: new Map<string, number>(), units: new Map<string, number>() };
  for (const entry of entries) {
    const each = amounts(entry);
    for (const [label, minutes] of each.hours)
      totals.hours.set(label, (totals.hours.get(label) ?? 0) + minutes);
    for (const [label, count] of each.units)
      totals.units.set(label, (totals.units.get(label) ?? 0) + count);
  }
  return [
    ...columns.hours.map((label) =>
      totals.hours.has(label) ? hours(totals.hours.get(label) ?? 0) : null,
    ),
    ...columns.units.map((label) => totals.units.get(label) ?? null),
  ];
}

/** Start, end, where, team, break, length: the cells every shift row shares. */
const shiftCells = (entry: WorkbookEntry, location: string): WorkbookCell[] => [
  twelveHour(entry.startTime),
  twelveHour(entry.endTime),
  location,
  entry.team,
  entry.breakMinutes > 0 ? entry.breakMinutes.toFixed(1) : null,
  hours(entry.workedMinutes),
];

export function buildTimesheetWorkbook(input: {
  from: string;
  to: string;
  /** The business, shown as the location of every shift. */
  location: string;
  currency: string;
  people: WorkbookPerson[];
  /** Approved, finished time only, in any order. */
  entries: WorkbookEntry[];
}): WorkbookSheet[] {
  const period = `${longDate(input.from)} - ${longDate(input.to)}`;
  const title = (name: string): WorkbookCell[] => [bold(name), bold(period)];
  const header = (...labels: string[]): WorkbookCell[] => labels.map(bold);
  const entries = [...input.entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.fullName.localeCompare(b.fullName),
  );
  const people = input.people
    .filter((person) => entries.some((entry) => entry.userId === person.userId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const of = (userId: string) => entries.filter((entry) => entry.userId === userId);
  const days: string[] = [];
  for (
    let day = utc(input.from);
    day <= utc(input.to);
    day = new Date(day.getTime() + 86_400_000)
  ) {
    days.push(day.toISOString().slice(0, 10));
  }
  const all = columnsOf(entries);
  const teams = [...new Set(entries.flatMap((entry) => entry.team ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );

  const overview: WorkbookSheet = {
    name: 'Overview',
    rows: [
      title('Overview'),
      header('Name', 'Employee ID', 'Gross Wage', 'Age', ...all.hours, ...all.units),
      ...people.map((person) => [
        bold(person.fullName),
        person.employeeId,
        person.gross === null ? null : money(person.gross, input.currency),
        person.age,
        ...payCells(of(person.userId), all),
      ]),
    ],
  };

  const details: WorkbookSheet = {
    name: 'Details',
    rows: [
      title('Details'),
      // Each day takes three columns: start, break, end.
      [bold('Name'), ...days.flatMap((day) => [bold(shortDate(day)), null, null])],
      ...people.map((person) => [
        bold(person.fullName),
        ...days.flatMap((day) => {
          const worked = of(person.userId).filter((entry) => entry.date === day);
          const first = worked[0];
          const last = worked[worked.length - 1];
          if (!first || !last) return [null, null, null];
          const unpaid = worked.reduce((sum, entry) => sum + entry.breakMinutes, 0);
          return [
            twelveHour(first.startTime),
            unpaid > 0 ? `${unpaid} min` : null,
            twelveHour(last.endTime),
          ];
        }),
      ]),
    ],
  };

  const byTeam: WorkbookSheet = {
    name: 'By Team',
    rows: [
      title('By Team'),
      header('Name', ...teams),
      ...people.map((person) => [
        bold(person.fullName),
        ...teams.map((team) => {
          const minutes = of(person.userId)
            .filter((entry) => entry.team === team)
            .reduce((sum, entry) => sum + entry.workedMinutes, 0);
          return minutes > 0 ? hours(minutes) : null;
        }),
      ]),
    ],
  };

  // Shifts carry no award tags here, so this sheet lists the people and nothing against them.
  const byTag: WorkbookSheet = {
    name: 'By Shift Award Tag',
    rows: [
      title('By Shift Award Tag'),
      header('Name'),
      ...people.map((person) => [bold(person.fullName)]),
    ],
  };

  const byComments: WorkbookSheet = {
    name: 'By Comments',
    rows: [
      title('By Comments'),
      header('Name', 'Shift Date', 'Start', 'End', 'Location', 'Team', 'Comments'),
      ...entries
        .filter((entry) => entry.note)
        .map((entry) => [
          bold(entry.fullName),
          shortDate(entry.date),
          twelveHour(entry.startTime),
          twelveHour(entry.endTime),
          input.location,
          entry.team,
          entry.note,
        ]),
    ],
  };

  const perDay: WorkbookSheet[] = days.map((day) => {
    const worked = entries.filter((entry) => entry.date === day);
    const columns = columnsOf(worked);
    return {
      name: dayName(day),
      rows: [
        title(dayName(day)),
        header(
          'Name',
          'Start',
          'End',
          'Locations',
          'Teams',
          'Breaks',
          'Length',
          ...columns.hours,
          ...columns.units,
        ),
        ...worked.map((entry) => [
          bold(entry.fullName),
          ...shiftCells(entry, input.location),
          ...payCells([entry], columns),
        ]),
      ],
    };
  });

  const perPerson: WorkbookSheet[] = people.map((person) => {
    const worked = of(person.userId);
    const columns = columnsOf(worked);
    return {
      name: person.fullName,
      rows: [
        title(person.fullName),
        header(
          'Date',
          'Start',
          'End',
          'Locations',
          'Teams',
          'Breaks',
          'Length',
          ...columns.hours,
          ...columns.units,
        ),
        ...worked.map((entry) => [
          bold(shortDate(entry.date)),
          ...shiftCells(entry, input.location),
          ...payCells([entry], columns),
        ]),
      ],
    };
  });

  return [overview, details, byTeam, byTag, byComments, ...perDay, ...perPerson];
}
