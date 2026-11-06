/**
 * Google Sheets reader — no API key.
 *
 * Reads one tab through the gviz CSV endpoint
 * (docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv), the same one the
 * slideshow's license plate uses. It answers cross-origin requests, so a
 * static page can read any sheet shared as "Anyone with the link -> Viewer".
 *
 * One gviz quirk to know about: it gives every column a single type, picked
 * by majority, and blanks the cells that don't fit. A column holding mostly
 * numbers drops the odd "$25". That's why the Form's amount question should
 * use number validation — see README.md.
 */

export class SheetError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'SheetError';
    this.status = status;
  }
}

/** Parses CSV text, including quoted cells with commas, quotes and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Reads a tab as `{ headers, rows }`, where each row is an array of trimmed
 * strings in header order. Fully blank rows are dropped.
 */
export async function fetchTab(sheetId, tab) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('headers', '1');
  if (tab) url.searchParams.set('sheet', tab);
  url.searchParams.set('_', String(Date.now()));

  let res;
  try {
    res = await fetch(url.toString(), { cache: 'no-store' });
  } catch {
    throw new SheetError('Could not reach Google Sheets.');
  }
  if (!res.ok) {
    throw new SheetError(
      res.status === 400 || res.status === 404
        ? `Sheet or tab "${tab}" not found`
        : `Google Sheets returned ${res.status}`,
      { status: res.status },
    );
  }

  const body = await res.text();
  // A sheet that isn't link-shared answers with a sign-in page, not CSV.
  if (/^\s*</.test(body)) {
    throw new SheetError('Sheet is not shared as "Anyone with the link"', { status: 403 });
  }

  const [headers = [], ...rest] = parseCsv(body);
  const rows = rest
    .map((row) => headers.map((_, i) => String(row[i] ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));
  return { headers: headers.map((h) => String(h).trim()), rows };
}

/** Spreadsheet truthiness: TRUE, yes, y, 1, x, and checkbox TRUE all count. */
export function isTruthy(value) {
  return /^(true|yes|y|1|x|approved|ok|done)$/i.test(String(value ?? '').trim());
}

/** Parses '$1,234.50' and friends into a number. */
export function parseAmount(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}
