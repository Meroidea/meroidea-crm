import Papa from 'papaparse';

/**
 * Reads the first sheet of an .xlsx workbook, or a .csv file, into rows of text cells.
 *
 * An .xlsx file is a zip of XML documents. Only what a price list needs is read here — the
 * shared strings and the first worksheet's cell values — which is small enough not to justify a
 * spreadsheet library as a dependency. Formulas give their last calculated value; dates and
 * number formats are returned as Excel stored them. It runs in the browser and in Node.
 */

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function zipEntries(view: DataView): ZipEntry[] {
  // The end-of-central-directory record sits at the very end, after an optional comment.
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip file');

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      name: decoder.decode(new Uint8Array(view.buffer, view.byteOffset + cursor + 46, nameLength)),
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      offset: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(view: DataView, entry: ZipEntry): Promise<string> {
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(bytes);
  if (entry.method !== 8) throw new Error('unsupported zip compression');
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code] ?? match;
    const point =
      code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return String.fromCodePoint(point);
  });

/** All <t> runs inside a string item, joined: rich text is stored as several runs. */
const textRuns = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((run) => decodeXml(run[1] ?? ''))
    .join('');

function columnIndex(reference: string): number {
  let index = 0;
  for (const letter of reference.replace(/\d+$/, ''))
    index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const view = new DataView(buffer);
  const entries = zipEntries(view);
  const find = (name: string) => entries.find((entry) => entry.name === name);

  const sheet =
    find('xl/worksheets/sheet1.xml') ??
    entries
      .filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheet) throw new Error('no worksheet found');

  const stringsEntry = find('xl/sharedStrings.xml');
  const shared = stringsEntry
    ? [...(await readEntry(view, stringsEntry)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((item) =>
        textRuns(item[1] ?? ''),
      )
    : [];

  const rows: string[][] = [];
  const xml = await readEntry(view, sheet);
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1] ?? '';
      const body = cell[2] ?? '';
      const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      const value =
        type === 's'
          ? (shared[Number(raw)] ?? '')
          : type === 'inlineStr'
            ? textRuns(body)
            : decodeXml(raw);
      const column = reference ? columnIndex(reference) : row.length;
      while (row.length < column) row.push('');
      row[column] = value.trim();
    }
    rows.push(row);
  }
  return rows.filter((row) => row.some((cell) => cell !== ''));
}

export function readCsv(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  return parsed.data.map((row) => row.map((cell) => String(cell ?? '').trim()));
}

/** Rows of a spreadsheet file, chosen by its extension. Rejects anything else. */
export async function readSpreadsheet(file: {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) return readXlsx(buffer);
  if (/\.csv$/i.test(file.name)) return readCsv(new TextDecoder().decode(buffer));
  throw new Error('unsupported file type');
}
