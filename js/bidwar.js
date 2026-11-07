/**
 * Bottom-bar bid war rotator (bidwar.html): takes turns showing the Party Game
 * bid war as a head-to-head VS bar and the top Pick a Baddie League write-ins.
 * The panels themselves live in js/warpanels.js, shared with bar.html.
 *
 * Totals come from the same Saturday Form tally as bar.html and the slideshow
 * (js/incentives.js), so only mod-approved votes count. Settings live in
 * CONFIG.bidwarBar.
 */
import { CONFIG } from './config.js';
import { fetchDonations } from './extralife.js';
import { isIncentivesConfigured, loadIncentives } from './incentives.js';
import { createWarPanels, rotate, demoModel, PARTY_MS, LEAGUE_MS } from './warpanels.js';
import { poll } from './ui.js';

// Donations are read for the whole team, as on bar.html, so Form votes can be
// matched against them.
CONFIG.scope = CONFIG.donationBar.scope;
CONFIG.id = CONFIG.donationBar.id;

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const DEMO = params.has('demo');

const chroma = params.get('chroma');
if (chroma) {
  document.body.dataset.chroma = 'true';
  document.body.style.background = `#${chroma.replace(/^#/, '')}`;
}

const panels = createWarPanels($('slide-party'), $('slide-league'));

// ---------------------------------------------------------------- rotation

// ?seconds= sets both panels' time at once; ?only= shows one panel.
const forced = Number(params.get('seconds')) * 1000;
const ms = (configured) => Math.max(4000, forced || configured);
const slides = {
  party: { el: $('slide-party'), ms: ms(PARTY_MS) },
  league: { el: $('slide-league'), ms: ms(LEAGUE_MS), onShow: panels.startLeague },
};
const only = params.get('only');
const order = slides[only] ? [only] : ['party', 'league'];
for (const [key, slide] of Object.entries(slides)) slide.el.hidden = !order.includes(key);
rotate(order.map((key) => slides[key]));

// -------------------------------------------------------------------- data

async function refresh() {
  if (DEMO) {
    panels.render(demoModel());
    return;
  }
  if (!isIncentivesConfigured()) return;

  // A failed donations read just means typed amounts are used; a failed sheet
  // read keeps the last good standings on screen.
  const donations = await fetchDonations().catch((err) => {
    console.warn('[bcl bidwar] donations could not be read; using typed amounts:', err.message);
    return [];
  });
  try {
    panels.render(await loadIncentives(donations));
  } catch (err) {
    console.warn('[bcl bidwar] standings could not be read:', err.message);
  }
}

poll(refresh, Math.max(20, CONFIG.poll.sheetSeconds));
