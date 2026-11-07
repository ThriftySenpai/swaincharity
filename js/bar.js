/**
 * Bottom-bar donation tracker: raised versus goal, plus the day's incentive —
 * either a fixed reward (optionally with the window's top donor) or the
 * current leader of one or more bid wars from the Saturday Form responses.
 *
 * On a bid war day the incentive half takes turns: that leaders summary, then
 * the Party Game VS bar and the Baddie League top picks from js/warpanels.js
 * (the same panels as bidwar.html).
 *
 * Always tracks the team in CONFIG.donationBar, not the site-wide `scope`,
 * though ?scope=&id= still override it for testing against a busy team.
 */
import { CONFIG, applyUrlOverrides } from './config.js';
import { fetchProfile, fetchDonations } from './extralife.js';
import { aggregate, resolveWindow } from './leaderboard.js';
import {
  isIncentivesConfigured, fetchResponses, buildIncentives, findIncentive, bidWarLeader,
} from './incentives.js';
import { createWarPanels, rotate, demoModel, PARTY_MS, LEAGUE_MS } from './warpanels.js';
import { money, el, clear, setProgress, poll } from './ui.js';

CONFIG.scope = CONFIG.donationBar.scope;
CONFIG.id = CONFIG.donationBar.id;
applyUrlOverrides();

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const DEMO = params.has('demo');
const SUMMARY_MS = (CONFIG.donationBar.summarySeconds ?? 10) * 1000;

const chroma = params.get('chroma');
if (chroma) {
  document.body.dataset.chroma = 'true';
  document.body.style.background = `#${chroma.replace(/^#/, '')}`;
}

/**
 * The incentive for right now: ?day= if given, else the day whose window is
 * live, else the next one coming up, else the last one. Re-run every poll so
 * the bar rolls over to the next day by itself.
 */
function currentIncentive() {
  const entries = CONFIG.donationBar.incentives ?? [];
  const forced = Number(params.get('day'));
  if (forced) return entries.find((e) => e.day === forced) ?? null;

  const now = Date.now();
  const dated = entries.map((entry) => ({ entry, window: resolveWindow(entry.window) }));
  const live = dated.find(({ window }) => now >= window.start && now <= window.end);
  const upcoming = dated
    .filter(({ window }) => window.start > now)
    .sort((a, b) => a.window.start - b.window.start)[0];
  return (live ?? upcoming ?? dated.at(-1))?.entry ?? null;
}

// -------------------------------------------------------------- rotation

// The VS and league panels are only built, and only rotate in, on a day with
// bid wars. Any other day the summary panel stays up on its own.
let warPanels = null;
let stopRotation = null;

function setRotation(on) {
  if (on === Boolean(stopRotation)) return;
  $('slide-party').hidden = !on;
  $('slide-league').hidden = !on;
  if (!on) {
    stopRotation();
    stopRotation = null;
    return;
  }
  warPanels ??= createWarPanels($('slide-party'), $('slide-league'));
  stopRotation = rotate([
    { el: $('slide-summary'), ms: SUMMARY_MS },
    { el: $('slide-party'), ms: PARTY_MS },
    { el: $('slide-league'), ms: LEAGUE_MS, onShow: warPanels.startLeague },
  ]);
}

// ---------------------------------------------------------------- render

let lastRaised = null;

function renderProgress(profile) {
  const raised = $('raised');
  raised.textContent = money(profile.sumDonations);

  // Restart the glow on every increase, not just the first.
  if (lastRaised !== null && profile.sumDonations > lastRaised) {
    raised.classList.remove('is-bumped');
    void raised.offsetWidth;
    raised.classList.add('is-bumped');
  }
  lastRaised = profile.sumDonations;

  const goal = profile.fundraisingGoal;
  const pct = goal > 0 ? (profile.sumDonations / goal) * 100 : 0;
  $('goal').textContent = goal > 0 ? `of ${money(goal)} goal` : '';
  $('pct').textContent = goal > 0 ? `${Math.floor(pct)}%` : '';
  setProgress($('fill'), pct);
}

function renderBidWars(entry, model) {
  const box = $('bidwars');
  clear(box);
  for (const { id, label } of entry.bidwars) {
    box.append(el('span', 'bar__war-label', label || id));

    if (!model) {
      // No sheet connected (or not loaded yet): point people at chat instead.
      box.append(el('span', 'bar__war-name bar__war-name--empty', 'Type !bidwar in chat'));
      box.append(el('span', 'bar__war-amount', ''));
      continue;
    }

    const lead = bidWarLeader(findIncentive(model, id));
    if (!lead) {
      box.append(el('span', 'bar__war-name bar__war-name--empty', 'No bids yet. Be the first!'));
      box.append(el('span', 'bar__war-amount', ''));
      continue;
    }

    const name = lead.tied
      ? `Tied: ${lead.tied.map((option) => option.title).join(' / ')}`
      : lead.option.title;
    box.append(el('span', 'bar__war-name', name));
    box.append(el('span', 'bar__war-amount', money(lead.amount)));
  }
}

function renderIncentive(entry, donations, model) {
  const section = $('incentive');
  const wars = Boolean(entry?.bidwars?.length);
  section.hidden = !entry?.reward && !wars;
  $('root').classList.toggle('bar__panel--solo', section.hidden);
  setRotation(wars);
  if (section.hidden) return;

  $('reward-row').hidden = wars;
  $('bidwars').hidden = !wars;
  if (wars) {
    $('kicker').textContent = `Day ${entry.day} ${entry.bidwars.length > 1 ? 'Bid Wars' : 'Bid War'}`;
    $('leader').hidden = true;
    renderBidWars(entry, model);
    warPanels?.render(DEMO ? demoModel() : model);
    return;
  }

  $('kicker').textContent = `Day ${entry.day} Incentive`;
  $('incentive-title').textContent = entry.title ?? '';
  $('reward').textContent = entry.reward;

  const leader = $('leader');
  leader.hidden = !entry.leader;
  if (!entry.leader) return;

  clear(leader);
  const [top] = aggregate(donations ?? [], resolveWindow(entry.window), { size: 1 }).rows;
  if (!top) {
    leader.textContent = 'No donations yet today. Be the first!';
    return;
  }
  leader.append('Leading: ', el('strong', null, top.name), ' · ');
  leader.append(el('span', 'bar__leader-amount', money(top.total)));
}

function showError(message) {
  const error = $('error');
  error.textContent = message;
  error.hidden = false;
}

// ------------------------------------------------------------------ boot

let loadedOnce = false;

// The sheet changes far less often than donations, so it is re-read on its
// own slower clock. A failed read keeps the last good copy.
let sheetCache = null;
let sheetReadAt = 0;

async function loadSheet() {
  if (!isIncentivesConfigured()) return null;
  if (sheetCache && Date.now() - sheetReadAt < CONFIG.poll.sheetSeconds * 1000) return sheetCache;
  try {
    sheetCache = await fetchResponses();
    sheetReadAt = Date.now();
  } catch (err) {
    console.error('[bcl bar] sheet', err);
  }
  return sheetCache;
}

async function refresh() {
  const entry = currentIncentive();
  const wantsLeader = Boolean(entry?.reward && entry.leader);
  const wantsWars = Boolean(entry?.bidwars?.length);

  const [profile, donations, sheet] = await Promise.all([
    fetchProfile(),
    wantsLeader || wantsWars ? fetchDonations() : Promise.resolve(null),
    wantsWars ? loadSheet() : Promise.resolve(null),
  ]);

  // Donations are needed to match Form responses to real donations.
  const model = sheet ? buildIncentives(sheet, donations ?? []) : null;

  renderProgress(profile);
  renderIncentive(entry, donations, model);
  $('error').hidden = true;
  loadedOnce = true;
}

// Never poll faster than 20s, however the config is set.
poll(async () => {
  try {
    await refresh();
  } catch (err) {
    console.error('[bcl bar]', err);
    // Keep the last good figures on screen; only complain if we have none.
    if (!loadedOnce) showError(err.message ?? 'Failed to load');
  }
}, Math.max(20, CONFIG.poll.donationsSeconds));
