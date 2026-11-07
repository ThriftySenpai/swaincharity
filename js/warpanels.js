/**
 * The two Saturday bid war panels, shared by bidwar.html and bar.html:
 *
 *   - party:  the Party Game bid war as a head-to-head VS bar
 *   - league: the top Pick a Baddie League write-ins, three rows at a time,
 *             sliding down to reveal the rest (up to six) and back
 *
 * Plus rotate(), which takes turns showing panels for set times. Styles are
 * in css/wars.css; each page sets its own panel padding. Settings live in
 * CONFIG.bidwarBar.
 */
import { CONFIG } from './config.js';
import { findIncentive } from './incentives.js';
import { money, el, clear, morphChildren } from './ui.js';

const SAT = CONFIG.saturday;
const SETTINGS = CONFIG.bidwarBar ?? {};

export const PARTY_MS = (SETTINGS.partySeconds ?? 10) * 1000;
export const LEAGUE_MS = (SETTINGS.leagueSeconds ?? 20) * 1000;

const LEAGUE_TOP = Math.min(6, Math.max(1, SETTINGS.leagueTop || 6));
const LEAGUE_VISIBLE = 3;
const PAUSE_MS = (SETTINGS.leaguePauseSeconds ?? 8) * 1000;
const HOLD_MS = (SETTINGS.leagueHoldSeconds ?? 7) * 1000;
const SLIDE_MS = 1400; // matches the .league transition in css/wars.css

/**
 * Puts an option's full title on the VS bar, or its `short` name from config
 * when the full one would be cut off.
 */
function fitName(node, option) {
  node.textContent = option.title;
  const short = SAT.party.options.find((o) => o.id === option.id)?.short;
  if (short && node.scrollWidth > node.clientWidth + 1) node.textContent = short;
}

function kicker(title) {
  const box = el('div', 'wars__kicker');
  const total = el('span', 'wars__total');
  box.append(el('span', null, title), total);
  return { box, total };
}

/**
 * Fills two empty elements with the party and league panels and returns
 * { render(model), startLeague() }. render() takes the incentives model (or
 * null for "nothing yet"); startLeague() restarts the league's
 * hold-and-scroll and should be called each time the league panel is shown.
 */
export function createWarPanels(partyEl, leagueEl) {
  // ---- party ---------------------------------------------------------------
  partyEl.classList.add('wars__slide', 'wars__slide--party');
  const partyKicker = kicker(SAT.party.title);
  const side = (dir) => {
    const box = el('div', `vs__side vs__side--${dir}`);
    const name = el('span', 'vs__name');
    const amount = el('span', 'vs__amount');
    if (dir === 'left') box.append(name, amount);
    else box.append(amount, name);
    return { box, name, amount };
  };
  const left = side('left');
  const right = side('right');
  const names = el('div', 'vs__names');
  names.append(left.box, el('span', 'vs__badge', 'VS'), right.box);
  const track = el('div', 'vs__track');
  const leftFill = el('div', 'vs__fill vs__fill--left');
  const rightFill = el('div', 'vs__fill vs__fill--right');
  track.append(leftFill, rightFill, el('div', 'vs__mid'));
  clear(partyEl);
  partyEl.append(partyKicker.box, names, track);

  // ---- league --------------------------------------------------------------
  leagueEl.classList.add('wars__slide', 'wars__slide--league');
  const leagueKicker = kicker(SAT.league.title);
  const viewport = el('div', 'league__viewport');
  const list = el('ol', 'league');
  viewport.append(list);
  clear(leagueEl);
  leagueEl.append(leagueKicker.box, viewport);

  let leagueCount = 0;
  let scrolled = false;
  let scrollTimers = [];
  const extraRows = () => Math.max(0, leagueCount - LEAGUE_VISIBLE);
  const setScroll = (rows) => viewport.style.setProperty('--scroll', String(rows));

  function startLeague() {
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

  // ---- render --------------------------------------------------------------
  function renderParty(war) {
    // Always the configured two options in config order, so the sides never
    // swap when the lead changes.
    const [a, b] = SAT.party.options.map(
      (o) => war?.children.find((c) => c.id === o.id) ?? { id: o.id, title: o.title, raised: 0 },
    );
    const total = a.raised + b.raised;
    const leftPct = total > 0 ? (a.raised / total) * 100 : 50;

    // Amounts first: they take their full width, and the names fit around them.
    left.amount.textContent = money(a.raised);
    right.amount.textContent = money(b.raised);
    fitName(left.name, a);
    fitName(right.name, b);
    leftFill.style.width = `${leftPct}%`;
    rightFill.style.width = `${100 - leftPct}%`;
    left.box.classList.toggle('is-leading', a.raised > b.raised);
    right.box.classList.toggle('is-leading', b.raised > a.raised);
    partyKicker.total.textContent = total > 0 ? `${money(total)} pledged` : 'No votes yet';
  }

  function renderLeague(war) {
    const rows = (war?.children ?? []).filter((c) => c.raised > 0).slice(0, LEAGUE_TOP);
    leagueKicker.total.textContent = war?.raised > 0 ? `${money(war.raised)} pledged` : '';

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

  render(null);
  return { render, startLeague };
}

/**
 * Shows each slide in turn: `slides` is [{ el, ms, onShow? }]. The live one
 * gets `is-live`. A single slide stays up, with onShow re-run every `ms`.
 * Returns stop(), which leaves the first slide showing.
 */
export function rotate(slides) {
  let current = 0;
  let timer = null;

  function show(index) {
    current = index % slides.length;
    slides.forEach((s, i) => s.el.classList.toggle('is-live', i === current));
    slides[current].onShow?.();
    timer = setTimeout(() => show(current + 1), slides[current].ms);
  }

  show(0);
  return () => {
    clearTimeout(timer);
    slides.forEach((s, i) => s.el.classList.toggle('is-live', i === 0));
  };
}

/** Made-up standings for lining sources up in OBS (?demo=1). */
export function demoModel() {
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
      node('f', 'Mahjong', 10 + Math.round(wobble() / 4)),
    ].sort((a, b) => b.raised - a.raised),
  };
  league.raised = league.children.reduce((s, c) => s + c.raised, 0);
  return { all: new Map([[SAT.party.id, party], [SAT.league.id, league]]) };
}
