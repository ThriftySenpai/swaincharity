/**
 * Bottom-bar donation tracker: raised versus goal, plus the day's incentive.
 *
 * Always tracks the team in CONFIG.donationBar, not the site-wide `scope`,
 * though ?scope=&id= still override it for testing against a busy team.
 */
import { CONFIG, applyUrlOverrides } from './config.js';
import { fetchProfile, fetchDonations } from './extralife.js';
import { aggregate, resolveWindow } from './leaderboard.js';
import { money, el, clear, setProgress, poll } from './ui.js';

CONFIG.scope = CONFIG.donationBar.scope;
CONFIG.id = CONFIG.donationBar.id;
applyUrlOverrides();

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

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

function renderIncentive(entry, donations) {
  const section = $('incentive');
  section.hidden = !entry?.reward;
  $('root').classList.toggle('bar__panel--solo', section.hidden);
  if (section.hidden) return;

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

async function refresh() {
  const entry = currentIncentive();
  const wantsLeader = Boolean(entry?.reward && entry.leader);

  const [profile, donations] = await Promise.all([
    fetchProfile(),
    wantsLeader ? fetchDonations() : Promise.resolve(null),
  ]);

  renderProgress(profile);
  renderIncentive(entry, donations);
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
