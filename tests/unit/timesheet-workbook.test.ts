import { inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  buildTimesheetWorkbook,
  PLAIN_HOURS,
  shortDate,
  twelveHour,
  type WorkbookCell,
  type WorkbookEntry,
} from '@/modules/timesheets/workbook';
import { sheetNames, writeWorkbook } from '@/server/xlsx';

const plain = (cell: WorkbookCell) => (cell && typeof cell === 'object' ? cell.value : cell);
const values = (rows: WorkbookCell[][]) => rows.map((row) => row.map(plain));

const entry = (overrides: Partial<WorkbookEntry>): WorkbookEntry => ({
  userId: 'a',
  fullName: 'Ava Nguyen',
  date: '2026-10-05',
  startTime: '11:00',
  endTime: '17:30',
  breakMinutes: 30,
  workedMinutes: 360,
  team: 'Floor',
  note: null,
  lines: [],
  ...overrides,
});

const line = (label: string, minutes: number | null, rate: string, cents: number) => ({
  shiftId: 'x',
  kind: 'ordinary' as const,
  label,
  minutes,
  rate,
  cents,
  costCents: cents,
  clause: '24.2',
});

const workbook = (entries: WorkbookEntry[]) =>
  buildTimesheetWorkbook({
    from: '2026-10-05',
    to: '2026-10-11',
    location: 'Harbour Kitchen',
    currency: 'AUD',
    people: [
      { userId: 'a', fullName: 'Ava Nguyen', employeeId: null, age: 30, gross: '660.09' },
      { userId: 'b', fullName: 'Ben Carter', employeeId: '100001', age: null, gross: null },
      { userId: 'c', fullName: 'Never Worked', employeeId: null, age: null, gross: null },
    ],
    entries,
  });

describe('the timesheet workbook', () => {
  const sheets = workbook([
    entry({
      lines: [
        line('Ordinary hours', 300, '33.05', 16525),
        line('Saturday', 60, '39.66', 3966),
        line('10 pm to midnight, per hour or part', null, '2.95', 590),
      ],
    }),
    entry({
      date: '2026-10-06',
      startTime: '10:00',
      endTime: '14:00',
      breakMinutes: 0,
      workedMinutes: 240,
      note: 'Covered for Dan',
    }),
    entry({
      userId: 'b',
      fullName: 'Ben Carter',
      date: '2026-10-05',
      startTime: '09:00',
      endTime: '13:00',
      breakMinutes: 0,
      workedMinutes: 240,
      team: 'Kitchen',
    }),
  ]);
  const sheet = (name: string) => values(sheets.find((each) => each.name === name)?.rows ?? []);

  it('has the overview sheets, then one per day and one per person who worked', () => {
    expect(sheets.map((each) => each.name)).toEqual([
      'Overview',
      'Details',
      'By Team',
      'By Shift Award Tag',
      'By Comments',
      '5 October',
      '6 October',
      '7 October',
      '8 October',
      '9 October',
      '10 October',
      '11 October',
      'Ava Nguyen',
      'Ben Carter',
    ]);
  });

  it('titles every sheet with its name and the period, in bold', () => {
    for (const each of sheets) {
      expect(each.rows[0]).toEqual([
        { value: each.name, bold: true },
        { value: '5 October 2026 - 11 October 2026', bold: true },
      ]);
    }
  });

  it('totals hours per pay rate and counts flat amounts on the Overview', () => {
    expect(sheet('Overview').slice(1)).toEqual([
      [
        'Name',
        'Employee ID',
        'Gross Wage',
        'Age',
        PLAIN_HOURS,
        'Ordinary hours',
        'Saturday',
        '10 pm to midnight, per hour or part',
      ],
      ['Ava Nguyen', null, '$660.09', 30, 4, 5, 1, 2],
      ['Ben Carter', '100001', null, null, 4, null, null, null],
    ]);
  });

  it('lays each day out as start, break and end on the Details sheet', () => {
    const [, header, ava] = sheet('Details');
    expect(header?.slice(0, 7)).toEqual([
      'Name',
      'Mon, 5 Oct 2026',
      null,
      null,
      'Tue, 6 Oct 2026',
      null,
      null,
    ]);
    expect(ava?.slice(0, 7)).toEqual([
      'Ava Nguyen',
      '11:00 AM',
      '30 min',
      '05:30 PM',
      '10:00 AM',
      null,
      '02:00 PM',
    ]);
  });

  it('splits hours by team, and lists only shifts that carry a comment', () => {
    expect(sheet('By Team').slice(1)).toEqual([
      ['Name', 'Floor', 'Kitchen'],
      ['Ava Nguyen', 10, null],
      ['Ben Carter', null, 4],
    ]);
    expect(sheet('By Comments').slice(2)).toEqual([
      [
        'Ava Nguyen',
        'Tue, 6 Oct 2026',
        '10:00 AM',
        '02:00 PM',
        'Harbour Kitchen',
        'Floor',
        'Covered for Dan',
      ],
    ]);
  });

  it('gives each day only the pay columns used that day, shifts in start order', () => {
    expect(sheet('5 October').slice(1)).toEqual([
      [
        'Name',
        'Start',
        'End',
        'Locations',
        'Teams',
        'Breaks',
        'Length',
        PLAIN_HOURS,
        'Ordinary hours',
        'Saturday',
        '10 pm to midnight, per hour or part',
      ],
      [
        'Ben Carter',
        '09:00 AM',
        '01:00 PM',
        'Harbour Kitchen',
        'Kitchen',
        null,
        4,
        4,
        null,
        null,
        null,
      ],
      ['Ava Nguyen', '11:00 AM', '05:30 PM', 'Harbour Kitchen', 'Floor', '30.0', 6, null, 5, 1, 2],
    ]);
    expect(sheet('7 October')).toHaveLength(2);
  });

  it('gives each person their own shifts by date', () => {
    expect(
      sheet('Ava Nguyen')
        .slice(2)
        .map((row) => row.slice(0, 3)),
    ).toEqual([
      ['Mon, 5 Oct 2026', '11:00 AM', '05:30 PM'],
      ['Tue, 6 Oct 2026', '10:00 AM', '02:00 PM'],
    ]);
  });

  it('writes times and dates the way the layout expects', () => {
    expect([twelveHour('00:05'), twelveHour('12:00'), twelveHour('17:30')]).toEqual([
      '12:05 AM',
      '12:00 PM',
      '05:30 PM',
    ]);
    expect(shortDate('2026-10-05')).toBe('Mon, 5 Oct 2026');
  });
});

/** Reads a zip written by the workbook writer back into its files. */
function unzip(file: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let at = 0;
  while (file.readUInt32LE(at) === 0x04034b50) {
    const size = file.readUInt32LE(at + 18);
    const nameLength = file.readUInt16LE(at + 26);
    const name = file.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + file.readUInt16LE(at + 28);
    files[name] = inflateRawSync(file.subarray(start, start + size)).toString('utf8');
    at = start + size;
  }
  return files;
}

describe('the Excel file writer', () => {
  const file = writeWorkbook([
    {
      name: 'Overview',
      rows: [
        [{ value: 'Name', bold: true }, 'A & B <c>'],
        ['Ava', 6.5, null, 'x'],
      ],
    },
    { name: 'A/B: very long sheet name that goes past the limit', rows: [] },
  ]);
  const files = unzip(file);

  it('produces the parts Excel needs, one sheet file per sheet', () => {
    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(file.subarray(-22).readUInt16LE(10)).toBe(7);
  });

  it('writes text escaped, numbers as numbers, bold cells in the bold style, and skips empty cells', () => {
    const sheet = files['xl/worksheets/sheet1.xml'] ?? '';
    expect(sheet).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>',
    );
    expect(sheet).toContain('A &amp; B &lt;c&gt;');
    expect(sheet).toContain('<c r="B2"><v>6.5</v></c>');
    expect(sheet).not.toContain('r="C2"');
    expect(sheet).toContain('r="D2"');
  });

  it('makes sheet names Excel will accept: no forbidden characters, 31 at most, no repeats', () => {
    expect(files['xl/workbook.xml']).toContain('name="A B  very long sheet name that"');
    expect(sheetNames(['Sam', 'sam', 'Sam'])).toEqual(['Sam', 'sam (2)', 'Sam (3)']);
    expect(sheetNames(['']).every((name) => name.length > 0)).toBe(true);
  });
});
