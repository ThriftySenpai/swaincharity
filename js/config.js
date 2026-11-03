/**
 * The knob file. Almost everything an organizer needs to change lives here.
 *
 * Every value can also be overridden from the query string for quick testing,
 * e.g. index.html?scope=teams&id=73266 — see applyUrlOverrides() at the bottom.
 */
export const CONFIG = {
  // ---- Extra Life -------------------------------------------------------
  apiBase: 'https://dd.extra-life.org/api',

  // 'participants' for one person's page, 'teams' for a whole team.
  // Team Swain is team 74893; Eric Hansen (captain) is participant 579801.
  scope: 'participants',
  id: 579801,
  eventId: 562, // Extra Life 2026

  donateUrl: 'https://dd.extra-life.org/participants/teamswain/donate',
  pageUrl: 'https://dd.extra-life.org/participants/teamswain',
  twitchChannel: 'swainbl',

  // ---- Presentation -----------------------------------------------------
  eventTitle: 'The Baddie Charity League',
  eventSubtitle: 'Extra Life 2026 · for Marshfield Children\'s Hospital',
  timezone: 'America/Chicago',
  currency: 'USD',
  leaderboardSize: 5,

  // How to treat donations with no donorID and no displayName. Roughly 10% of
  // real donations look like this. 'individual' lists them separately,
  // 'hide' drops them. Never merge them: on a live team the anonymous rows
  // summed to $10,021, which would invent a fake #1 donor.
  anonymousMode: 'individual',

  // ---- Stream windows ---------------------------------------------------
  // Local wall-clock times in the `timezone` above. `id` is what you pass to
  // overlay.html?window=<id>.
  windows: [
    { id: 'friday-night',   label: 'Friday Night',   start: '2026-11-02T18:00', end: '2026-11-07T02:00' },
    { id: 'saturday',       label: 'Saturday',       start: '2026-11-07T10:00', end: '2026-11-08T02:00' },
    { id: 'sunday',         label: 'Sunday',         start: '2026-11-08T10:00', end: '2026-11-08T22:00' },
  ],

  // ---- Bottom-bar tracker (bar.html) -------------------------------------
  // The strip that sits in the bottom bar of 2026/bcl-2026-overlay.png. It
  // always tracks the whole team, whatever `scope` above is set to.
  donationBar: {
    scope: 'teams',
    id: 74893, // Team Swain, Extra Life 2026

    // One entry per stream day. The bar shows the day whose `window` is
    // happening now, else the next one coming up, else the last one. Force a
    // day with bar.html?day=2. Leave `reward` blank to hide the incentive and
    // let the progress bar take the full width.
    //
    // `leader: true` shows who is currently top donor inside that day's
    // window, for "Top Donor wins..." style incentives.
    incentives: [
      { day: 1, window: 'friday-night', title: 'Top Donor', reward: "Cruz's License Plate", leader: true },
      { day: 2, window: 'saturday',     title: '',          reward: '',                     leader: false },
      { day: 3, window: 'sunday',       title: '',          reward: '',                     leader: false },
    ],
  },

  // ---- Polling ----------------------------------------------------------
  // Extra Life asks for no more than one request every 15s. We stay well
  // inside that by caching aggressively and only fetching new pages, but the
  // burst spacing below is what governs the one-time backfill.
  poll: {
    donationsSeconds: 30,
    sheetSeconds: 60,
    minRequestSpacingMs: 1000,
  },

  // ---- Google Sheet (incentives) ---------------------------------------
  // Read through the Sheets API v4, which is CORS-clean. Publish-to-web CSV
  // and Apps Script web apps are not, so don't substitute them.
  //
  // Setup: share the sheet "Anyone with the link -> Viewer", then create a
  // browser API key restricted to (a) the Google Sheets API and (b) an HTTP
  // referrer of your Pages domain. See README.md.
  sheet: {
    id: '',      // e.g. '1AbC...'  — leave blank to disable the incentives UI
    apiKey: '',  // e.g. 'AIza...'
    tabs: {
      incentives:  'Incentives',
      allocations: 'Allocations',
      claims:      'Claims',
      settings:    'Settings',
    },
  },

  // ---- Donor self-service claim form -----------------------------------
  // A Google Form whose responses land in the `Claims` tab. The entry.NNN
  // ids come from the form's prefill link (see README.md).
  claimForm: {
    url: '',
    // Leave any of these blank and that field simply is not prefilled; the
    // donor fills it in on the form instead.
    entries: { donationId: '', donorName: '', amount: '', incentiveId: '' },
  },
};

const NUMERIC_KEYS = new Set(['id', 'eventId', 'leaderboardSize']);

export function applyUrlOverrides(search = window.location.search) {
  const params = new URLSearchParams(search);
  for (const [key, value] of params) {
    if (key === 'sheetId') { CONFIG.sheet.id = value; continue; }
    if (key === 'apiKey') { CONFIG.sheet.apiKey = value; continue; }
    if (!(key in CONFIG)) continue;
    if (typeof CONFIG[key] === 'object') continue;
    CONFIG[key] = NUMERIC_KEYS.has(key) ? Number(value) : value;
  }
  return CONFIG;
}

export function scopePath() {
  return `${CONFIG.scope}/${CONFIG.id}`;
}
