/**
 * The knob file. Almost everything an organizer needs to change lives here.
 *
 * For quick testing, `scope`, `id` and `eventId` can be overridden from the
 * query string, e.g. index.html?scope=teams&id=73266. Nothing else can — see
 * applyUrlOverrides() at the bottom.
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

  // ---- Between-games slideshow (slides.html) ----------------------------
  // Full-screen OBS source that rotates through assets/img/Slides. Browsers
  // can't list a folder, so every slide is named here, in the order shown.
  //
  // `days` limits a slide to certain stream days (0 = Sun ... 5 = Fri,
  // 6 = Sat). A stream day runs until `dayRolloverHour` the next morning, so
  // Friday's schedule stays up through a stream that runs past midnight.
  // Leave `days` off to show a slide every day. Force a day for testing with
  // slides.html?day=fri.
  slideshow: {
    folder: 'assets/img/Slides/',
    seconds: 10,
    fadeMs: 900,
    dayRolloverHour: 2,
    slides: [
      { file: 'bcl-2026-main-screen.png' },
      { file: 'bcl-2026-weekend-schedule.png' },
      { file: 'bcl-2026-fri-schedule.png', days: [5] },
      { file: 'bcl-2026-sat-schedule.png', days: [6] },
      { file: 'bcl-2026-sun-schedule.png', days: [0] },
      { file: 'bcl-2026-saturday.png', days: [6] },
      { file: 'bcl-2026-saturday_bidwar-pick.png', days: [6] },
      { file: 'bcl-2026-saturday_bidwar-party.png', days: [6] },
      { file: 'top-donor-license-plate-blank.png', plate: true },
    ],

    // The plate text is read live from a link-shared Google Sheet through the
    // gviz CSV endpoint, which needs no API key. Note the text sits in B1:
    // A1 holds the "Driver's License Text:" label.
    plate: {
      sheetId: '1-jwagBKevlwJJVNBjQ16ZUn_as6ZUqvctSy_cACHsrY',
      tab: 'LiveSources',
      cell: 'B1',
      refreshSeconds: 30,
      // A license-plate font file to use instead of the Oswald stand-in,
      // e.g. 'assets/fonts/license-plate.ttf'. Blank uses Oswald.
      font: '',
    },
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

/*
 * The only settings a URL may change, each with a validator that returns the
 * parsed value or null to ignore it. Keep this list short: the site is public,
 * so an open override would let anyone send a link to this domain that loads
 * fake totals from their own server (`apiBase`) or points the Donate button at
 * a scam page (`donateUrl`).
 */
const URL_OVERRIDES = {
  scope: (value) => (value === 'teams' || value === 'participants' ? value : null),
  id: (value) => (/^\d+$/.test(value) ? Number(value) : null),
  eventId: (value) => (/^\d+$/.test(value) ? Number(value) : null),
};

export function applyUrlOverrides(search = window.location.search) {
  const params = new URLSearchParams(search);
  for (const [key, parse] of Object.entries(URL_OVERRIDES)) {
    if (!params.has(key)) continue;
    const value = parse(params.get(key));
    if (value !== null) CONFIG[key] = value;
  }
  return CONFIG;
}

export function scopePath() {
  return `${CONFIG.scope}/${CONFIG.id}`;
}
