/**
 * Google Sheets reader.
 *
 * Uses the Sheets API v4, which sends permissive CORS headers. The two
 * obvious-looking alternatives do not work from a static page:
 *   - docs.google.com publish-to-web CSV has no Access-Control-Allow-Origin
 *   - script.google.com Apps Script web apps are CORS-blocked
 *
 * The API key here is public by necessity. It is restricted to the Sheets API
 * and to an HTTP referrer, and it only ever reads a sheet that is already
 * link-public, so the exposure is limited to read access you already granted.
 */
import { CONFIG } from './config.js';

const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'SheetError';
    this.status = status;
  }
}

/** True when a sheet id and API key have both been filled in. */
export function isSheetConfigured() {
  return Boolean(CONFIG.sheet.id && CONFIG.sheet.apiKey);
}

function headerKey(header) {
  return String(header || '')
    .trim()
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))
    .replace(/^(.)/, (chr) => chr.toLowerCase());
}

/**
 * Turn a range's raw rows into objects keyed by camel-cased header.
 * Blank rows and rows with no first cell are skipped, which is what you get
 * when a spreadsheet has trailing empty rows.
 */
function rowsToObjects(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const [headerRow, ...dataRows] = values;
  const keys = headerRow.map(headerKey);
  return dataRows
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const obj = {};
      keys.forEach((key, i) => {
        if (key) obj[key] = String(row[i] ?? '').trim();
      });
      return obj;
    });
}

/**
 * Read every configured tab in one request.
 * Returns `{ incentives, allocations, claims, settings }` as arrays of objects.
 */
export async function fetchSheet() {
  if (!isSheetConfigured()) {
    return { configured: false, incentives: [], allocations: [], claims: [], settings: {} };
  }

  const { id, apiKey, tabs } = CONFIG.sheet;
  const url = new URL(`${API_BASE}/${encodeURIComponent(id)}/values:batchGet`);
  const order = ['incentives', 'allocations', 'claims', 'settings'];
  for (const name of order) {
    url.searchParams.append('ranges', `${tabs[name]}!A:Z`);
  }
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('key', apiKey);

  let res;
  try {
    res = await fetch(url.toString());
  } catch {
    throw new SheetError('Could not reach Google Sheets.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message ? ` — ${body.error.message}` : '';
    } catch {
      /* fall through to the bare status */
    }
    if (res.status === 403) {
      throw new SheetError(`Sheet access denied${detail}`, { status: 403 });
    }
    if (res.status === 404) {
      throw new SheetError(`Sheet not found${detail}`, { status: 404 });
    }
    throw new SheetError(`Google Sheets returned ${res.status}${detail}`, { status: res.status });
  }

  const body = await res.json();
  const ranges = body.valueRanges ?? [];
  const out = { configured: true };
  order.forEach((name, i) => {
    out[name] = rowsToObjects(ranges[i]?.values);
  });

  // Settings is a key/value tab, so flatten it into a plain object.
  out.settings = Object.fromEntries(
    (out.settings ?? []).filter((r) => r.key).map((r) => [r.key, r.value ?? '']),
  );

  return out;
}

/** Spreadsheet truthiness: TRUE, yes, y, 1, x, and checkbox TRUE all count. */
export function isTruthy(value) {
  return /^(true|yes|y|1|x|approved|done)$/i.test(String(value ?? '').trim());
}

/** Parses '$1,234.50' and friends into a number. */
export function parseAmount(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}
