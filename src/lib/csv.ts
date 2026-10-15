import Papa from 'papaparse';

/**
 * Rows as CSV, safe to open in a spreadsheet. A cell starting with =, +, -, @, tab or return is
 * prefixed with a quote so it is shown as text rather than run as a formula: exports carry text
 * that strangers typed into public forms.
 */
export function toCsv(rows: Parameters<typeof Papa.unparse>[0]): string {
  return Papa.unparse(rows, { escapeFormulae: true });
}
