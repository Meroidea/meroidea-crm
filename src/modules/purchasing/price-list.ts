/** Turns the rows of a supplier's spreadsheet into price-list items. Pure; used by the browser. */

export type PriceListItem = {
  name: string;
  code: string | null;
  unit: string | null;
  unitPrice: string;
};

export type ParsedPriceList = {
  items: PriceListItem[];
  /** Rows that had no name or no usable price. */
  skipped: number;
  /** The header text matched for each field, so the admin can see what was understood. */
  columns: { name: string; price: string; code: string | null; unit: string | null };
};

const HEADERS = {
  name: /^(item|items|product|products|description|name|item name|product name|item description)$/,
  price: /(price|cost|rate|each|\bex\b|amount)/,
  code: /(code|sku|item no|item number|product no|product id|part)/,
  unit: /^(unit|units|uom|pack|pack size|size|unit size|packaging|sold by)$/,
};

const clean = (value: string | undefined) => (value ?? '').trim();
const normal = (value: string | undefined) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * "$1,234.5" → "1234.50". A spreadsheet stores prices as binary floats (4.2 can arrive as
 * 4.199999999), so the value is rounded to cents once here; no arithmetic is done on it after.
 */
export function normalizePrice(value: string): string | null {
  const stripped = clean(value).replace(/[$,\s]|aud/gi, '');
  if (!/^\d+(\.\d+)?$/.test(stripped)) return null;
  const rounded = Number(stripped).toFixed(2);
  return /^\d{1,9}\.\d{2}$/.test(rounded) ? rounded : null;
}

export function parsePriceList(rows: string[][]): ParsedPriceList | { error: string } {
  // The header is the first of the opening rows that names both an item and a price column.
  for (let index = 0; index < Math.min(rows.length, 15); index += 1) {
    const header = (rows[index] ?? []).map(normal);
    const name = header.findIndex((cell) => HEADERS.name.test(cell));
    const price = header.findIndex((cell, column) => column !== name && HEADERS.price.test(cell));
    if (name < 0 || price < 0) continue;
    const code = header.findIndex(
      (cell, column) => column !== name && column !== price && HEADERS.code.test(cell),
    );
    const unit = header.findIndex(
      (cell, column) => ![name, price, code].includes(column) && HEADERS.unit.test(cell),
    );

    const original = rows[index] ?? [];
    const items: PriceListItem[] = [];
    let skipped = 0;
    for (const row of rows.slice(index + 1)) {
      const itemName = clean(row[name]);
      const unitPrice = normalizePrice(row[price] ?? '');
      if (!itemName || !unitPrice) {
        skipped += 1;
        continue;
      }
      items.push({
        name: itemName.slice(0, 200),
        code: code >= 0 ? clean(row[code]).slice(0, 60) || null : null,
        unit: unit >= 0 ? clean(row[unit]).slice(0, 60) || null : null,
        unitPrice,
      });
    }
    return {
      items,
      skipped,
      columns: {
        name: clean(original[name]),
        price: clean(original[price]),
        code: code >= 0 ? clean(original[code]) : null,
        unit: unit >= 0 ? clean(original[unit]) : null,
      },
    };
  }
  return {
    error:
      'Could not find the columns. The sheet needs a header row with an item column (such as “Item” or “Description”) and a price column (such as “Price” or “Unit cost”).',
  };
}
