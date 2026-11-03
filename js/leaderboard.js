/**
 * Donor aggregation and time-window maths.
 *
 * The one rule that matters: repeat donations from the same person collapse
 * into a single row whose total is the sum, but genuinely anonymous donations
 * must never be collapsed together. On a real 2026 team, 45 of 448 donations
 * had neither a donorID nor a displayName; merging them produced a phantom
 * "$10,021" top donor that does not exist.
 */
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/** How far `timeZone` sits from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(epochMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(epochMs).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - epochMs;
}

/**
 * Turn a local wall-clock string like '2026-11-06T18:00' into an epoch, read
 * in `timeZone`. Iterates because the offset itself depends on the instant,
 * which matters across a daylight-saving boundary.
 */
export function zonedToEpoch(localISO, timeZone = CONFIG.timezone) {
  if (!localISO) return NaN;
  const [datePart, timePart = '00:00'] = String(localISO).trim().split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
  if (!y || !m || !d) return NaN;

  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  let guess = naive;
  for (let i = 0; i < 3; i += 1) {
    const next = naive - zoneOffsetMs(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** Formats an instant in the configured event timezone. */
export function formatInZone(epochMs, options = {}) {
  if (!epochMs) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
  }).format(epochMs);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * Resolve a window id into `{ id, label, start, end }` with epoch bounds.
 * Understands the named windows from config plus:
 *   - 'alltime'       no bounds
 *   - 'live'          the configured window containing now, else last 12h
 *   - 'last:<hours>'  a rolling window, e.g. 'last:8'
 *   - 'custom:<startISO>:<endISO>'
 */
export function resolveWindow(id = 'alltime') {
  const value = String(id || 'alltime');

  if (value === 'alltime') {
    return { id: 'alltime', label: 'All time', start: -Infinity, end: Infinity };
  }

  if (value === 'live') {
    const now = Date.now();
    const current = CONFIG.windows
      .map((w) => resolveWindow(w.id))
      .find((w) => now >= w.start && now <= w.end);
    return current ?? resolveWindow('last:12');
  }

  if (value.startsWith('last:')) {
    const hours = Number(value.slice(5)) || 12;
    const now = Date.now();
    return {
      id: value,
      label: `Last ${hours} hour${hours === 1 ? '' : 's'}`,
      start: now - hours * 3600_000,
      end: now,
    };
  }

  if (value.startsWith('custom:')) {
    // Format: custom:<local start>|<local end>, e.g. custom:2026-11-06T18:00|2026-11-07T02:00
    const [startISO = '', endISO = ''] = value.slice('custom:'.length).split('|');
    const start = zonedToEpoch(startISO);
    const end = zonedToEpoch(endISO);
    return {
      id: value,
      label: 'Custom range',
      start: Number.isNaN(start) ? -Infinity : start,
      end: Number.isNaN(end) ? Infinity : end,
    };
  }

  const named = CONFIG.windows.find((w) => w.id === value);
  if (named) {
    return {
      id: named.id,
      label: named.label,
      start: zonedToEpoch(named.start),
      end: zonedToEpoch(named.end),
    };
  }

  return resolveWindow('alltime');
}

/** Builds the id string for an explicit range, for use in URLs. */
export function customWindowId(startISO, endISO) {
  return `custom:${startISO}|${endISO}`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The identity a donation counts towards, or null when the donor is fully
 * anonymous. Prefers donorID; falls back to the display name so that a donor
 * whose id is hidden but whose name is shown still aggregates correctly.
 */
function donorKey(donation) {
  if (donation.donorID) return `id:${donation.donorID}`;
  const name = normalizeName(donation.displayName);
  return name ? `name:${name}` : null;
}

export function inWindow(donation, window) {
  return donation.createdAt >= window.start && donation.createdAt <= window.end;
}

/**
 * Aggregate donations into a ranked leaderboard.
 * Returns `{ rows, totalRaised, donationCount, donorCount }`.
 */
export function aggregate(donations, window, options = {}) {
  const {
    size = CONFIG.leaderboardSize,
    anonymousMode = CONFIG.anonymousMode,
    includeRegFees = false,
  } = options;

  const groups = new Map();
  const anonymous = [];
  let totalRaised = 0;
  let donationCount = 0;

  for (const donation of donations) {
    if (!inWindow(donation, window)) continue;
    if (!includeRegFees && donation.isRegFee) continue;

    const amount = typeof donation.amount === 'number' ? donation.amount : 0;
    totalRaised += amount;
    donationCount += 1;

    const key = donorKey(donation);

    if (!key) {
      // Fully anonymous: each donation stands alone, or is hidden entirely.
      if (anonymousMode === 'hide') continue;
      anonymous.push({
        key: `anon:${donation.donationID}`,
        name: 'Anonymous',
        total: amount,
        count: 1,
        avatarUrl: donation.avatarUrl,
        anonymous: true,
        lastAt: donation.createdAt,
      });
      continue;
    }

    const existing = groups.get(key);
    if (existing) {
      existing.total += amount;
      existing.count += 1;
      if (donation.createdAt > existing.lastAt) {
        existing.lastAt = donation.createdAt;
        if (donation.avatarUrl) existing.avatarUrl = donation.avatarUrl;
      }
    } else {
      groups.set(key, {
        key,
        name: donation.displayName || 'Anonymous',
        total: amount,
        count: 1,
        avatarUrl: donation.avatarUrl,
        anonymous: !donation.displayName,
        lastAt: donation.createdAt,
      });
    }
  }

  const rows = [...groups.values(), ...anonymous]
    .sort((a, b) => b.total - a.total || b.count - a.count || a.lastAt - b.lastAt)
    .slice(0, size)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return { rows, totalRaised, donationCount, donorCount: groups.size + anonymous.length };
}
