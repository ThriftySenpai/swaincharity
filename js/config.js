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

    // On a bid war day the incentive half rotates: this summary of the
    // leaders, then the Party Game VS bar and the Baddie League top picks
    // (their times are `partySeconds` / `leagueSeconds` in `bidwarBar`).
    summarySeconds: 10,

    // One entry per stream day. The bar shows the day whose `window` is
    // happening now, else the next one coming up, else the last one. Force a
    // day with bar.html?day=2. Leave `reward` blank to hide the incentive and
    // let the progress bar take the full width.
    //
    // `leader: true` shows who is currently top donor inside that day's
    // window, for "Top Donor wins..." style incentives.
    //
    // `bidwars` instead shows who is leading each listed bid war, read from
    // the incentives Google Sheet. `id` is the bid war's id in the
    // `Incentives` tab; `label` is the short name shown on the bar.
    incentives: [
      { day: 1, window: 'friday-night', title: 'Top Donor', reward: "Cruz's License Plate", leader: true },
      {
        day: 2, window: 'saturday',
        bidwars: [
          { id: 'party',  label: 'Party Game' },
          { id: 'league', label: 'Baddie League' },
        ],
      },
      { day: 3, window: 'sunday',       title: '',          reward: '',                     leader: false },
    ],
  },

  // ---- Bottom-bar bid war rotator (bidwar.html) --------------------------
  // Sits right of bar.html and takes turns showing the Party Game VS bar and
  // the top Baddie League write-ins, from the `saturday` Form tally below.
  bidwarBar: {
    partySeconds: 10,   // time on the Party Game VS panel
    leagueSeconds: 20,  // time on the Baddie League panel
    // The league panel shows 3 rows at a time. With more picks than that (up
    // to `leagueTop`, max 6), it holds on the top 3 for `leaguePauseSeconds`,
    // slides down to show the rest for `leagueHoldSeconds`, then slides back
    // up. Pause + hold + ~3s of sliding should fit inside `leagueSeconds`.
    leagueTop: 6,
    leaguePauseSeconds: 8,
    leagueHoldSeconds: 7,
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
      // `bidwar` overlays a live leaderboard of that bid war (an id from
      // `saturday` below) in the middle of the slide.
      { file: 'bcl-2026-saturday_bidwar-pick.png', days: [6], bidwar: 'league' },
      { file: 'bcl-2026-saturday_bidwar-party.png', days: [6] },
      // { file: 'top-donor-license-plate-blank.png', plate: true },
    ],

    // How many rows a `bidwar` slide's leaderboard shows. Its totals are the
    // same Saturday Form tally the bottom bar uses, so only mod-approved
    // votes count.
    bidwarTop: 5,

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
    sheetSeconds: 30,
    minRequestSpacingMs: 1000,
  },

  // ---- Saturday incentives (one Google Form) ----------------------------
  // Donors fill in a Form after donating; its responses tab is read through
  // the gviz CSV endpoint, so no API key is needed — just share the sheet as
  // "Anyone with the link -> Viewer". See README.md for the Form questions.
  saturday: {
    // From the responses sheet's URL: docs.google.com/spreadsheets/d/THIS_PART/edit
    // Leave blank to switch the incentives off.
    // It's the same sheet the slideshow's license plate reads.
    sheetId: '1-jwagBKevlwJJVNBjQ16ZUn_as6ZUqvctSy_cACHsrY',
    tab: 'DonationIncentiveForm',
    // The Form's full viewform URL (not the forms.gle short link, which
    // can't carry pre-filled answers). The site's Vote buttons open it.
    formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfgZw0wLHOLIAGuST31IC9FXyLHjEmdNFecSeVTjpsRoRXpiA/viewform',
    // Only donations made inside this stream window can match a response.
    window: 'saturday',
    // true: no vote counts until a mod ticks `approved`, even one that
    // matches a donation exactly. false: matching votes count on their own.
    requireApproval: true,

    // Pre-filled answers for vote.html's buttons. Each `entry.` id comes from
    // the Form's "Get pre-filled link"; the choice texts must match the
    // "Which Incentive?" options exactly, or that answer is left blank.
    prefill: {
      name: 'entry.1799618009',
      amount: 'entry.1102454459',
      incentive: 'entry.1138443792',
      partyChoice: 'Party Game Bid war',
      leagueChoice: 'Pick a Baddy League',
    },

    // Each column is found by a word in its header (case does not matter),
    // so the Form questions can be worded freely as long as each contains its
    // word. `approved` is a checkbox column mods add to the responses tab.
    // `incentive` is the optional "Which Incentive?" question: when its answer
    // names one incentive (by that incentive's `choice` words), the response
    // counts toward that one only.
    columns: {
      name: 'name',
      amount: 'amount',
      incentive: 'incentive',
      party: 'party',
      league: 'league',
      approved: 'approved',
    },

    party: {
      id: 'party',
      title: 'Pick a Party Game',
      choice: ['party'],
      // `match` is extra words that count as a vote, on top of the title.
      // `short` is used on the VS bar where the full title doesn't fit.
      options: [
        { id: 'party-hk',      title: 'Hello Kitty Party Land', short: 'Hello Kitty', match: ['hello kitty', 'kitty', 'hk'] },
        { id: 'party-machine', title: 'Machine Party',          match: ['machine'] },
      ],
    },
    league: {
      id: 'league',
      title: 'Pick a Baddie League',
      choice: ['league', 'baddy', 'baddie'],
    },
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
