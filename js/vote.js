/**
 * Vote page: lists Saturday's donations, each with buttons that open the
 * vote Form with the donor's name, amount and incentive already filled in.
 * Mods still approve every vote in the sheet before it counts.
 */
import { CONFIG, applyUrlOverrides } from './config.js';
import { fetchProfile, fetchDonations, ExtraLifeError } from './extralife.js';
import { resolveWindow, inWindow, formatInZone } from './leaderboard.js';
import { SheetError } from './sheet.js';
import { isIncentivesConfigured, loadIncentives } from './incentives.js';
import { money, plural, el, clear, morphChildren, setProgress, poll, relativeTime } from './ui.js';

applyUrlOverrides();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?window=alltime shows every donation, handy for testing before Saturday.
const windowId = params.get('window') || CONFIG.saturday.window;

const state = { donations: [], model: null, search: '' };

// ------------------------------------------------------------- the Form

/** The Form link with this donation's answers filled in. */
function prefillUrl(donation, incentive) {
  const { formUrl, prefill = {} } = CONFIG.saturday;
  const url = new URL(formUrl);
  url.searchParams.set('usp', 'pp_url');
  if (prefill.name) url.searchParams.set(prefill.name, donation.displayName || 'Anonymous');
  if (prefill.amount && typeof donation.amount === 'number') {
    url.searchParams.set(prefill.amount, String(Math.round(donation.amount * 100) / 100));
  }
  const choice = incentive === 'party' ? prefill.partyChoice : prefill.leagueChoice;
  if (prefill.incentive && choice) url.searchParams.set(prefill.incentive, choice);
  return url.toString();
}

function voteButton(donation, incentive, label) {
  const link = el('a', 'btn btn--sm', label);
  link.href = prefillUrl(donation, incentive);
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

// ------------------------------------------------------------ donations

/** Donation ids whose vote a mod has already approved. */
function countedIds() {
  const ids = new Set();
  for (const war of state.model?.top ?? []) {
    for (const option of war.children) {
      for (const c of option.contributions) if (c.donationId) ids.add(String(c.donationId));
    }
  }
  return ids;
}

function renderDonations() {
  const window_ = resolveWindow(windowId);
  const inWin = state.donations.filter((d) => inWindow(d, window_));
  const query = state.search.trim().toLowerCase();
  const shown = query
    ? inWin.filter((d) => (d.displayName || 'Anonymous').toLowerCase().includes(query))
    : inWin;
  const counted = countedIds();

  $('donations-range').textContent = Number.isFinite(window_.start)
    ? `${window_.label}: ${formatInZone(window_.start)} – ${formatInZone(window_.end)} · ${plural(inWin.length, 'donation')}`
    : `${window_.label} · ${plural(inWin.length, 'donation')}`;

  const list = document.createElement('div');
  if (!shown.length) {
    const text = query
      ? `No donations match "${state.search.trim()}".`
      : Date.now() < window_.start
        ? `Voting opens when the ${window_.label} stream starts.`
        : 'No donations yet. Be the first!';
    list.append(el('li', 'empty', text));
  }

  for (const d of shown) {
    const li = el('li', 'vote-row');
    li.dataset.key = String(d.donationID);

    const who = el('div', 'vote-row__who');
    const name = el('span', 'vote-row__name', d.displayName || 'Anonymous');
    who.append(name);
    who.append(el('span', 'vote-row__when', relativeTime(d.createdAt)));
    if (d.message) who.append(el('span', 'vote-row__msg', d.message));
    li.append(who);

    li.append(el('span', 'vote-row__amount', typeof d.amount === 'number' ? money(d.amount) : 'Hidden'));

    const actions = el('div', 'vote-row__actions');
    if (counted.has(String(d.donationID))) {
      actions.append(el('span', 'badge badge--met', 'Vote counted'));
    } else {
      actions.append(voteButton(d, 'party', 'Party Game'));
      actions.append(voteButton(d, 'league', 'Baddie League'));
    }
    li.append(actions);
    list.append(li);
  }

  morphChildren($('donations'), list);
}

// ------------------------------------------------------------ standings

function standingsCard(war) {
  const card = el('article', 'card');
  const title = el('h3', 'incentive__title', war.title);
  card.append(title);

  if (!war.children.some((c) => c.raised > 0) && war.allowWriteIns) {
    card.append(el('p', 'card__note', 'No approved picks yet. Write in the first one!'));
    return card;
  }

  const max = Math.max(...war.children.map((c) => c.raised), 1);
  const list = el('ul', 'bidwar');
  for (const child of war.children.slice(0, 8)) {
    const li = el('li', `bidwar__row bidwar__row--${child.rank === 1 && child.raised > 0 ? 'lead' : 'other'}`);
    li.dataset.key = child.id;
    const head = el('div', 'bidwar__head');
    head.append(el('span', 'bidwar__name', child.title));
    head.append(el('span', 'bidwar__amount', money(child.raised)));
    li.append(head);
    const bar = el('div', 'progress progress--sm');
    const fill = el('div', 'progress__fill');
    bar.append(fill);
    li.append(bar);
    setProgress(fill, (child.raised / max) * 100);
    list.append(li);
  }
  card.append(list);
  return card;
}

function renderStandings() {
  const box = document.createElement('div');
  const note = $('standings-note');

  if (!state.model) {
    box.append(el('p', 'empty', 'Standings are not available right now.'));
  } else {
    for (const war of state.model.top) box.append(standingsCard(war));
    const { pending } = state.model.stats;
    note.textContent = pending
      ? `Approved votes only · ${plural(pending, 'vote')} waiting for a mod`
      : 'Approved votes only';
  }
  morphChildren($('standings'), box);
}

// --------------------------------------------------------------- loaders

async function loadDonations() {
  try {
    state.donations = await fetchDonations();
  } catch (err) {
    console.error('[bcl vote] donations', err);
    if (!state.donations.length) {
      clear($('donations'));
      $('donations').append(
        el('li', 'empty', err instanceof ExtraLifeError ? err.message : 'Could not load donations from Extra Life.'),
      );
      return;
    }
  }
  renderDonations();
}

async function loadStandings() {
  if (!isIncentivesConfigured()) {
    renderStandings();
    return;
  }
  try {
    state.model = await loadIncentives(state.donations);
  } catch (err) {
    console.error('[bcl vote] standings', err);
    if (!state.model) $('standings-note').textContent = err instanceof SheetError ? err.message : 'Could not load standings.';
  }
  renderStandings();
  // Counted badges come from the sheet, so refresh the list too.
  renderDonations();
}

async function loadProfile() {
  try {
    const profile = await fetchProfile();
    if (profile.donateUrl) {
      $('donate-btn').href = profile.donateUrl;
      $('nav-donate').href = profile.donateUrl;
    }
  } catch {
    // The configured donate link is already in place.
  }
}

// ------------------------------------------------------------------ boot

function start() {
  for (const id of ['donate-btn', 'nav-donate']) $(id).href = CONFIG.donateUrl;
  $('event-subtitle').textContent = CONFIG.eventSubtitle;

  if (CONFIG.saturday.formUrl) {
    $('blank-form').href = CONFIG.saturday.formUrl;
    $('fallback').hidden = false;
  }

  $('search').addEventListener('input', (event) => {
    state.search = event.target.value;
    renderDonations();
  });

  loadProfile();
  poll(async () => {
    await loadDonations();
    await loadStandings();
  }, CONFIG.poll.donationsSeconds);
}

start();
