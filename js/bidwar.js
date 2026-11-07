/**
 * Bottom-bar bid war rotator (bidwar.html): takes turns showing the Party Game
 * bid war as a head-to-head VS bar and the top Pick a Baddie League write-ins.
 *
 * Totals come from the same Saturday Form tally as bar.html and the slideshow
 * (js/incentives.js), so only mod-approved votes count. Settings live in
 * CONFIG.bidwarBar.
 */
import { CONFIG } from './config.js';
import { fetchDonations } from './extralife.js';
import { isIncentivesConfigured, loadIncentives, findIncentive } from './incentives.js';
import { money, el, clear, morphChildren, poll } from './ui.js';

// Donations are read for the whole team, as on bar.html, so Form votes can be
// matched against them.
CONFIG.scope = CONFIG.donationBar.scope;
CONFIG.id = CONFIG.donationBar.id;

const SETTINGS = CONFIG.bidwarBar ?? {};
const SAT = CONFIG.saturday;
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const DEMO = params.has('demo');

const chroma = params.get('chroma');
if (chroma) {
  document.body.dataset.chroma = 'true';
  document.body.style.background = `#${chroma.replace(/^#/, '')}`;
}

// ---------------------------------------------------------------- rotation

const slides = { party: $('slide-party'), league: $('slide-league') };
const only = params.get('only');
const order = slides[only] ? [only] : ['party', 'league'];
for (const [key, slide] of Object.entries(slides)) slide.hidden = !order.includes(key);

// Each panel has its own time on screen; ?seconds= sets both at once.
const forcedSeconds = Number(params.get('seconds'));
const durationMs = (key) => {
  const configured = { party: SETTINGS.partySeconds ?? 10, league: SETTINGS.leagueSeconds ?? 20 }[key];
  return Math.max(4, forcedSeconds || configured) * 1000;
};
let current = 0;
let rotateTimer = null;

function show(index) {
  current = index % order.length;
  const key = order[current];
  order.forEach((k, i) => slides[k].classList.toggle('is-live', i === current));
  if (key === 'league') startLeagueScroll();

  // With one panel only, this re-runs the same panel, which replays the
  // league's hold-and-scroll on its own clock.
  clearTimeout(rotateTimer);
  rotateTimer = setTimeout(() => show(current + 1), durationMs(key));
}

// ---- league scroll ---------------------------------------------------------
// The league panel shows LEAGUE_VISIBLE rows. With more picks than that, it
// holds on the top rows, slides down to reveal the rest, holds briefly, then
// slides back so it always leaves on the leaders.

const LEAGUE_TOP = Math.min(6, Math.max(1, SETTINGS.leagueTop || 6));
const LEAGUE_VISIBLE = 3;
const PAUSE_MS = (SETTINGS.leaguePauseSeconds ?? 8) * 1000;
const HOLD_MS = (SETTINGS.leagueHoldSeconds ?? 7) * 1000;
const SLIDE_MS = 1400; // matches the .league transition in bidwar.css

const viewport = $('league-viewport');
let leagueCount = 0;
let scrolled = false;
let scrollTimers = [];

const extraRows = () => Math.max(0, leagueCount - LEAGUE_VISIBLE);

function setScroll(rows) {
  viewport.style.setProperty('--scroll', String(rows));
}

function startLeagueScroll() {
  scrollTimers.forEach(clearTimeout);
  scrolled = false;
  setScroll(0);
  scrollTimers = [
    setTimeout(() => {
      scrolled = true;
      setScroll(extraRows());
    }, PAUSE_MS),
    setTimeout(() => {
      scrolled = false;
      setScroll(0);
    }, PAUSE_MS + SLIDE_MS + HOLD_MS),
  ];
}

show(0);

// ---------------------------------------------------------------- render

$('party-title').textContent = SAT.party.title;
$('league-title').textContent = SAT.league.title;

/** The name shown on the VS bar: `short` from config if set, else the title. */
function shortName(option) {
  return SAT.party.options.find((o) => o.id === option.id)?.short || option.title;
}

function renderParty(war) {
  // Always the configured two options in config order, so the sides never
  // swap when the lead changes.
  const [left, right] = SAT.party.options.map(
    (o) => war?.children.find((c) => c.id === o.id) ?? { id: o.id, title: o.title, raised: 0 },
  );
  const total = left.raised + right.raised;
  const leftPct = total > 0 ? (left.raised / total) * 100 : 50;

  $('vs-left-name').textContent = shortName(left);
  $('vs-right-name').textContent = shortName(right);
  $('vs-left-amount').textContent = money(left.raised);
  $('vs-right-amount').textContent = money(right.raised);
  $('vs-left-fill').style.width = `${leftPct}%`;
  $('vs-right-fill').style.width = `${100 - leftPct}%`;
  $('vs-left-name').parentElement.classList.toggle('is-leading', left.raised > right.raised);
  $('vs-right-name').parentElement.classList.toggle('is-leading', right.raised > left.raised);
  $('party-total').textContent = total > 0 ? `${money(total)} pledged` : 'No votes yet';
}

function renderLeague(war) {
  const list = $('league-list');
  const rows = (war?.children ?? []).filter((c) => c.raised > 0).slice(0, LEAGUE_TOP);
  $('league-total').textContent = war?.raised > 0 ? `${money(war.raised)} pledged` : '';

  leagueCount = rows.length;
  viewport.classList.toggle('is-scrolling', rows.length > LEAGUE_VISIBLE);
  // A refresh mid-scroll keeps the list scrolled to the (new) bottom.
  setScroll(scrolled ? extraRows() : 0);

  if (!rows.length) {
    list.className = 'league';
    clear(list);
    list.append(el('li', 'league__empty', 'No picks yet. Donate & write in your Baddie!'));
    return;
  }

  // Three rows only fit at the smaller size; one or two get the roomier one.
  list.className = `league league--${rows.length >= 3 ? 3 : 2}`;
  const lead = rows[0].raised;
  const next = document.createElement('ol');
  rows.forEach((row, i) => {
    const li = el('li', 'league__row');
    li.dataset.key = row.id;
    li.dataset.rank = String(i + 1);
    li.style.setProperty('--share', `${(row.raised / lead) * 100}%`);
    li.append(el('span', 'league__rank', String(i + 1)));
    li.append(el('span', 'league__name', row.title));
    li.append(el('span', 'league__amount', money(row.raised)));
    next.append(li);
  });
  // Drop the empty message before morphing so it can't be reused as a row.
  if (list.querySelector('.league__empty')) clear(list);
  morphChildren(list, next);
}

function render(model) {
  renderParty(model ? findIncentive(model, SAT.party.id) : null);
  renderLeague(model ? findIncentive(model, SAT.league.id) : null);
}

// -------------------------------------------------------------------- data

function demoModel() {
  const wobble = () => Math.round(Math.random() * 40);
  const node = (id, title, raised) => ({ id, title, raised });
  const party = {
    children: [
      node(SAT.party.options[0].id, SAT.party.options[0].title, 185 + wobble()),
      node(SAT.party.options[1].id, SAT.party.options[1].title, 140 + wobble()),
    ],
  };
  const league = {
    children: [
      node('a', 'Zoe, Neeko, Lux & friends', 220 + wobble()),
      node('b', 'All Yordles', 150 + wobble()),
      node('c', 'Shadow Isles Only', 95 + wobble()),
      node('d', 'Monster Hunter: Wilds', 60 + wobble()),
      node('e', 'Bilgewater Pirates', 25 + wobble()),
      node('f', 'Mahjong', 10 + wobble() / 4),
    ].sort((a, b) => b.raised - a.raised),
  };
  league.raised = league.children.reduce((s, c) => s + c.raised, 0);
  const all = new Map([[SAT.party.id, party], [SAT.league.id, league]]);
  return { all };
}

async function refresh() {
  if (DEMO) {
    render(demoModel());
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
    render(await loadIncentives(donations));
  } catch (err) {
    console.warn('[bcl bidwar] standings could not be read:', err.message);
  }
}

render(null);
poll(refresh, Math.max(20, CONFIG.poll.sheetSeconds));
