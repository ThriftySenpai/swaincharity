/**
 * Extra Life / DonorDrive API client.
 *
 * The public API is CORS-open, so this runs entirely in the browser with no
 * backend. It does have several sharp edges that silently break naive code,
 * all of which are handled here:
 *
 *   - `limit` above 100 returns 400 with an empty body.
 *   - `offset=0` returns 400. The first page must omit `offset` entirely.
 *   - Reading past the last page returns 204 No Content, so `.json()` throws.
 *   - Offset paging over a live DESC-ordered feed drifts as new donations
 *     arrive, which duplicates rows. Everything is deduped by donationID.
 */
import { CONFIG, scopePath } from './config.js';

const PAGE_SIZE = 100;
const CACHE_VERSION = 1;

// ---------------------------------------------------------------------------
// Request pacing + conditional requests
// ---------------------------------------------------------------------------

const etags = new Map(); // url -> { etag, body }
let chain = Promise.resolve();
let lastRequestAt = 0;

/** Serializes requests and spaces them out, per the API's rate-limit guidance. */
function paced(fn) {
  const run = chain.then(async () => {
    const wait = CONFIG.poll.minRequestSpacingMs - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this link rejects.
  chain = run.catch(() => {});
  return run;
}

export class ExtraLifeError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'ExtraLifeError';
    this.status = status;
    this.url = url;
  }
}

function buildUrl(path, params = {}) {
  const url = new URL(`${CONFIG.apiBase}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * GET a JSON resource. Returns null for 204 (past the end of a collection)
 * rather than throwing, since that is a normal terminating condition.
 */
async function getJson(url) {
  return paced(async () => {
    const cached = etags.get(url);
    const headers = cached ? { 'If-None-Match': cached.etag } : {};

    let res;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new ExtraLifeError('Could not reach Extra Life. Check your connection.', { url });
    }

    if (res.status === 304 && cached) return cached.body;
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new ExtraLifeError(`Extra Life returned ${res.status}`, { status: res.status, url });
    }

    const text = await res.text();
    if (!text.trim()) return null;

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ExtraLifeError('Extra Life returned a malformed response', { url });
    }

    const etag = res.headers.get('etag');
    if (etag) etags.set(url, { etag, body });
    return body;
  });
}

/**
 * Fetch one page of a collection.
 * An `offset` of 0 is deliberately omitted — sending it explicitly is a 400.
 */
async function fetchPage(path, offset = 0, extraParams = {}) {
  const params = { limit: PAGE_SIZE, ...extraParams };
  if (offset > 0) params.offset = offset;
  const body = await getJson(buildUrl(path, params));
  return Array.isArray(body) ? body : [];
}

/**
 * Walk every page of a collection and return every row, in order.
 * `maxPages` is a safety valve against an unbounded loop.
 */
async function fetchAllRows(path, { maxPages = 60, onProgress } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await fetchPage(path, page * PAGE_SIZE);
    all.push(...rows);
    onProgress?.(all.length);
    // A short page means we reached the end; a 204 already gave us [].
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Walk every page, keeping the first row seen for each `idKey`.
 * Only safe where the id is genuinely unique per row, such as donationID —
 * offset paging over a live feed re-serves rows as new ones arrive, and this
 * is what throws those duplicates away.
 */
async function fetchAllPages(path, idKey, options = {}) {
  const seen = new Map();
  for (const row of await fetchAllRows(path, options)) {
    const id = row[idKey];
    if (id != null && !seen.has(id)) seen.set(id, row);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Public resources
// ---------------------------------------------------------------------------

/** The participant or team profile: totals, goal, avatar, stream state. */
export async function fetchProfile() {
  const raw = await getJson(buildUrl(scopePath()));
  if (!raw) throw new ExtraLifeError('No profile returned');
  // Participants and teams use different keys for the same ideas.
  return {
    name: raw.displayName ?? raw.name ?? 'Extra Life',
    avatarUrl: raw.avatarImageURL ?? '',
    sumDonations: raw.sumDonations ?? 0,
    numDonations: raw.numDonations ?? 0,
    fundraisingGoal: raw.fundraisingGoal ?? 0,
    eventName: raw.eventName ?? '',
    teamName: raw.teamName ?? raw.name ?? '',
    numParticipants: raw.numParticipants ?? 1,
    streamIsLive: Boolean(raw.streamIsLive),
    streamingChannel: raw.streamingChannel ?? CONFIG.twitchChannel,
    donateUrl: raw.links?.donate ?? CONFIG.donateUrl,
    pageUrl: raw.links?.page ?? CONFIG.pageUrl,
    raw,
  };
}

/*
 * There is also a `/donors` endpoint that returns donors pre-aggregated by the
 * API, which looks like the obvious source for an all-time leaderboard. It is
 * deliberately not used here, because on a real team its rows could not be
 * reconciled either way:
 *
 *   - It emits one row per donor per recipient, so 21 donors who gave to more
 *     than one team member appeared twice. Deduping by donorID undercounts them.
 *   - It also emitted one donor twice with an identical donorID, sum and
 *     timestamp for a single $110 donation. Summing the rows overcounts that.
 *
 * Across 360 rows those cancelled out to $110 off the team's own reported
 * total. The donations feed, by contrast, matched `sumDonations` to the cent.
 * So both leaderboards are computed from donations and always reconcile with
 * the headline figure.
 */

/** A single donation, used to verify what a donor claims they gave. */
export async function fetchDonation(donationId) {
  if (!donationId) return null;
  const path = `${scopePath()}/donations/${encodeURIComponent(donationId)}`;
  try {
    const raw = await getJson(buildUrl(path));
    return raw ? normalizeDonation(raw) : null;
  } catch (err) {
    if (err instanceof ExtraLifeError && err.status === 404) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Donations, with an incremental cache
// ---------------------------------------------------------------------------

function cacheKey() {
  return `bcl:donations:v${CACHE_VERSION}:${CONFIG.scope}:${CONFIG.id}`;
}

function readCache() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.donations) ? parsed : null;
  } catch {
    return null; // Private browsing, cleared storage, corrupt JSON — all fine.
  }
}

function writeCache(donations) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ donations, fetchedAt: Date.now() }));
  } catch {
    // Over quota or storage disabled. The site works without the cache.
  }
}

function normalizeDonation(d) {
  return {
    donationID: d.donationID,
    donorID: d.donorID ?? null,
    displayName: d.displayName ?? null,
    amount: typeof d.amount === 'number' ? d.amount : null,
    message: d.message ?? null,
    incentiveID: d.incentiveID ?? null,
    isRegFee: Boolean(d.isRegFee),
    participantID: d.participantID ?? null,
    recipientName: d.recipientName ?? null,
    avatarUrl: d.avatarImageURL ?? '',
    createdAt: Date.parse(d.createdDateUTC ?? '') || 0,
    createdDateUTC: d.createdDateUTC ?? null,
  };
}

/**
 * All donations for the configured scope, newest first.
 *
 * The first call backfills every page and caches the result. Later calls only
 * fetch forward from the newest known donation, so a live stream costs about
 * one request per poll instead of a full re-walk.
 */
export async function fetchDonations({ force = false, onProgress } = {}) {
  const path = `${scopePath()}/donations`;
  const cached = force ? null : readCache();

  if (!cached) {
    const rows = await fetchAllPages(path, 'donationID', { onProgress });
    const donations = rows.map(normalizeDonation).sort((a, b) => b.createdAt - a.createdAt);
    writeCache(donations);
    return donations;
  }

  const known = new Map(cached.donations.map((d) => [d.donationID, d]));
  let foundOverlap = false;

  // Page forward until we hit something we already have. Normally page 1 is
  // enough; the loop only continues if more than 100 donations landed since
  // the last poll.
  for (let page = 0; page < 10 && !foundOverlap; page += 1) {
    const rows = await fetchPage(path, page * PAGE_SIZE);
    if (!rows.length) break;
    for (const row of rows) {
      if (known.has(row.donationID)) foundOverlap = true;
      else known.set(row.donationID, normalizeDonation(row));
    }
    if (rows.length < PAGE_SIZE) break;
  }

  const donations = [...known.values()].sort((a, b) => b.createdAt - a.createdAt);
  writeCache(donations);
  return donations;
}

/** Drops the cached donations for the current scope. */
export function clearDonationCache() {
  try {
    localStorage.removeItem(cacheKey());
  } catch {
    /* nothing to do */
  }
}
