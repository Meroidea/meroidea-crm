import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { readCsv, readSpreadsheet, readXlsx } from '@/lib/spreadsheet';
import { normalizePrice, parsePriceList } from '@/modules/purchasing/price-list';
import {
  canDeliverOn,
  describeDeliveryDays,
  nextDeliveryDates,
} from '@/modules/purchasing/schedule';
import { createSupplierSchema, placeOrderSchema } from '@/modules/purchasing/schemas';
import { orderNumber } from '@/modules/purchasing/types';

/** Builds a zip the way a spreadsheet program does: deflated entries and a central directory. */
function zip(files: Record<string, string>, compress = true): ArrayBuffer {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = compress ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    chunks.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...chunks, directoryBytes, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

const SHARED = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="7" uniqueCount="7"><si><t>Code</t></si><si><t>Description</t></si><si><t>Pack Size</t></si><si><t>Unit Price (ex GST)</t></si><si><t>Flour &amp; Co plain flour</t></si><si><r><t>Olive </t></r><r><rPr><b/></rPr><t xml:space="preserve">oil</t></r></si><si><t>12.5 kg bag</t></si></sst>`;
const SHEET = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" s="1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>FL-01</t></is></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" s="2"><v>21.399999999999999</v></c></row><row r="3"><c r="B3" t="s"><v>5</v></c><c r="D3"><v>48</v></c></row><row r="4"><c r="A4"/></row></sheetData></worksheet>`;
const workbook = (compress = true) =>
  zip(
    {
      '[Content_Types].xml': '<Types/>',
      'xl/sharedStrings.xml': SHARED,
      'xl/worksheets/sheet1.xml': SHEET,
    },
    compress,
  );

describe('reading a spreadsheet', () => {
  const expected = [
    ['Code', 'Description', 'Pack Size', 'Unit Price (ex GST)'],
    ['FL-01', 'Flour & Co plain flour', '12.5 kg bag', '21.399999999999999'],
    ['', 'Olive oil', '', '48'],
  ];

  it('reads shared, inline and rich-text strings, numbers and gaps from an .xlsx file', async () => {
    expect(await readXlsx(workbook())).toEqual(expected);
  });

  it('reads entries stored without compression too', async () => {
    expect(await readXlsx(workbook(false))).toEqual(expected);
  });

  it('reads a CSV with quoted commas', () => {
    expect(readCsv('Item,Price\n"Beans, black",3.5\n\n')).toEqual([
      ['Item', 'Price'],
      ['Beans, black', '3.5'],
    ]);
  });

  it('picks the reader from the file name and refuses other types', async () => {
    const file = (name: string, buffer: ArrayBuffer) => ({ name, arrayBuffer: async () => buffer });
    expect(await readSpreadsheet(file('List.XLSX', workbook()))).toEqual(expected);
    await expect(readSpreadsheet(file('list.pdf', new ArrayBuffer(8)))).rejects.toThrow();
    await expect(
      readXlsx(new TextEncoder().encode('not a zip at all, just text').buffer as ArrayBuffer),
    ).rejects.toThrow();
  });
});

describe('understanding a price list', () => {
  it('finds the columns by their headers and cleans the prices', async () => {
    const parsed = parsePriceList(await readXlsx(workbook()));
    expect(parsed).toEqual({
      items: [
        { name: 'Flour & Co plain flour', code: 'FL-01', unit: '12.5 kg bag', unitPrice: '21.40' },
        { name: 'Olive oil', code: null, unit: null, unitPrice: '48.00' },
      ],
      skipped: 0,
      columns: {
        name: 'Description',
        price: 'Unit Price (ex GST)',
        code: 'Code',
        unit: 'Pack Size',
      },
    });
  });

  it('skips a title above the header and rows without a name or a price', () => {
    const parsed = parsePriceList([
      ['Harbour Foods price list'],
      ['Item', 'Price'],
      ['Rice', '$1,200.00'],
      ['', '5'],
      ['Sugar', 'POA'],
    ]);
    expect(parsed).toMatchObject({ items: [{ name: 'Rice', unitPrice: '1200.00' }], skipped: 2 });
  });

  it('explains what is missing when there is no recognisable header', () => {
    expect(
      parsePriceList([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toHaveProperty('error');
  });

  it('normalises prices and rejects what is not one', () => {
    expect(normalizePrice('4.199999999')).toBe('4.20');
    expect(normalizePrice(' $ 7 ')).toBe('7.00');
    expect(normalizePrice('-3')).toBeNull();
    expect(normalizePrice('call us')).toBeNull();
  });
});

describe('delivery dates', () => {
  // Thursday 8 October 2026.
  const now = { date: '2026-10-08', time: '13:00' };
  const rules = { deliveryDays: [1, 4], leadDays: 2, cutoffTime: '14:00' };

  it('offers only delivery weekdays that can still be ordered for', () => {
    expect(nextDeliveryDates(rules, now, 3)).toEqual([
      { date: '2026-10-12', orderBy: '2026-10-10' },
      { date: '2026-10-15', orderBy: '2026-10-13' },
      { date: '2026-10-19', orderBy: '2026-10-17' },
    ]);
  });

  it('honours the cut-off time on the last ordering day', () => {
    const saturday = { date: '2026-10-10', time: '14:00' };
    expect(canDeliverOn(rules, '2026-10-12', saturday)).toBe(true);
    expect(canDeliverOn(rules, '2026-10-12', { ...saturday, time: '14:01' })).toBe(false);
    expect(canDeliverOn(rules, '2026-10-12', { date: '2026-10-11', time: '09:00' })).toBe(false);
  });

  it('refuses a day the supplier does not deliver, and allows any day when none are set', () => {
    expect(canDeliverOn(rules, '2026-10-13', now)).toBe(false);
    expect(
      canDeliverOn({ deliveryDays: [], leadDays: 0, cutoffTime: null }, '2026-10-08', now),
    ).toBe(true);
  });

  it('describes the delivery days in words', () => {
    expect(describeDeliveryDays([4, 1])).toBe('Mon and Thu');
    expect(describeDeliveryDays([1, 3, 5])).toBe('Mon, Wed and Fri');
    expect(describeDeliveryDays([])).toBe('Any day');
  });
});

describe('purchasing forms', () => {
  it('accepts weekday tick-boxes as strings and its own output', () => {
    const once = createSupplierSchema.parse({
      name: ' Harbour Foods ',
      orderEmail: 'Orders@Example.com',
      deliveryDays: ['4', '1', '1'],
      leadDays: '2',
      cutoffTime: '',
    });
    expect(once).toMatchObject({
      name: 'Harbour Foods',
      orderEmail: 'orders@example.com',
      deliveryDays: [1, 4],
      leadDays: 2,
      cutoffTime: null,
    });
    expect(createSupplierSchema.parse(once)).toEqual(once);
  });

  it('needs at least one line with a sensible quantity', () => {
    const base = { supplierId: '11111111-1111-4111-8111-111111111111', deliveryDate: '2026-10-12' };
    const line = { supplierItemId: '22222222-2222-4222-8222-222222222222' };
    expect(placeOrderSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      placeOrderSchema.safeParse({ ...base, lines: [{ ...line, quantity: '-1' }] }).success,
    ).toBe(false);
    expect(
      placeOrderSchema.safeParse({ ...base, lines: [{ ...line, quantity: '2.5' }] }).success,
    ).toBe(true);
  });

  it('formats order numbers', () => {
    expect(orderNumber(7)).toBe('PO-0007');
    expect(orderNumber(12345)).toBe('PO-12345');
  });
});
