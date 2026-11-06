/**
 * Saturday's two donation incentives, tallied from one Google Form.
 *
 *   - Party Game: a bid war between the options in CONFIG.saturday.party
 *   - Baddie League: donors write in their own pick and picks race each other
 *
 * Every Form response is one row: name, amount, party vote, league write-in,
 * plus an `approved` column mods tick by hand. A row counts when:
 *
 *   1. its name and amount match a real Saturday donation on Extra Life (the
 *      donation's own amount is used, and each donation backs one row), or
 *   2. a mod has ticked `approved` — for anonymous donors, typos and votes
 *      taken from chat. The typed amount is used.
 *
 * Writing "no", "spam" or "reject" in `approved` stops a row counting even if
 * it matches. Everything else waits as pending.
 *
 * If the Form's "Which Incentive?" answer names one incentive, the row counts
 * toward that one only. Otherwise one row can vote in both, and its full
 * amount counts toward each.
 * League write-ins are grouped by a loose key (case, punctuation, accents,
 * spacing and a leading "the" are ignored), shown under the most popular
 * spelling. To merge a typo, fix the cell in the sheet.
 */
import { CONFIG } from './config.js';
import { fetchTab, isTruthy, parseAmount, SheetError } from './sheet.js';
import { resolveWindow, inWindow } from './leaderboard.js';

/** The grouping key for write-ins, names and party votes. */
export function matchKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function isRejected(value) {
  return /^(no|n|reject|rejected|spam|ignore)$/i.test(String(value ?? '').trim());
}

/** True when a sheet id has been filled in. */
export function isIncentivesConfigured() {
  return Boolean(CONFIG.saturday?.sheetId);
}

/** Reads the Form responses tab. */
export async function fetchResponses() {
  const { sheetId, tab } = CONFIG.saturday;
  const responses = await fetchTab(sheetId, tab);
  // gviz quietly serves the first tab when the named one doesn't exist, so a
  // wrong tab name shows up as missing columns rather than an error.
  const col = locateColumns(responses.headers);
  if (col.amount < 0 || (col.party < 0 && col.league < 0)) {
    throw new SheetError(
      `Tab "${tab}" not found, or its questions don't contain the words "amount", "party" and "league"`,
    );
  }
  return responses;
}

/**
 * Finds each column by a word in its header, so the Form's questions can be
 * worded however you like as long as each contains its keyword.
 */
function locateColumns(headers) {
  const keys = headers.map((h) => h.toLowerCase());
  const find = (word) => keys.findIndex((h) => h.includes(String(word).toLowerCase()));
  const out = {};
  for (const [field, word] of Object.entries(CONFIG.saturday.columns)) out[field] = find(word);
  out.timestamp = find('timestamp');
  return out;
}

function makeNode({ id, title, parentId = null, type = 'option', writeIn = false, sortOrder = 0 }) {
  return {
    id, type, parentId, title, writeIn, sortOrder,
    description: '', target: 0, active: true, allowWriteIns: false,
    raised: 0, contributions: [], children: [],
  };
}

/**
 * @param {{headers: string[], rows: string[][]}} responses  from fetchResponses()
 * @param {Array} donations  normalized donations from the Extra Life API
 */
export function buildIncentives(responses, donations = []) {
  const cfg = CONFIG.saturday;
  const nodes = new Map();

  // ---- the two bid wars --------------------------------------------------
  const party = makeNode({ id: cfg.party.id, title: cfg.party.title, type: 'bidwar', sortOrder: 1 });
  const league = makeNode({ id: cfg.league.id, title: cfg.league.title, type: 'bidwar', sortOrder: 2 });
  league.allowWriteIns = true;
  nodes.set(party.id, party);
  nodes.set(league.id, league);

  const partyOptions = cfg.party.options.map((option, i) => {
    const node = makeNode({ id: option.id, title: option.title, parentId: party.id, sortOrder: i + 1 });
    node.keywords = [option.title, ...(option.match ?? [])].map(matchKey).filter(Boolean);
    nodes.set(node.id, node);
    return node;
  });

  /** The party option a vote names, matched on any of its keywords. */
  const partyVote = (value) => {
    const key = ` ${matchKey(value)} `;
    if (!key.trim()) return null;
    return partyOptions.find((o) => o.keywords.some((k) => key.includes(` ${k} `))) ?? null;
  };

  const leagueByKey = new Map();
  const leaguePick = (value) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = matchKey(text);
    if (!key) return null;
    let node = leagueByKey.get(key);
    if (!node) {
      node = makeNode({ id: `${league.id}~${key.replace(/ /g, '-')}`, title: text, parentId: league.id, writeIn: true });
      node.spellings = new Map();
      leagueByKey.set(key, node);
      nodes.set(node.id, node);
    }
    node.spellings.set(text, (node.spellings.get(text) ?? 0) + 1);
    return node;
  };

  // ---- Saturday donations, for matching ---------------------------------
  const window = resolveWindow(cfg.window);
  const pool = donations.filter(
    (d) => typeof d.amount === 'number' && d.displayName && inWindow(d, window),
  );
  const used = new Set();

  /** An unused Saturday donation with this name and amount, if exactly one fits. */
  const matchDonation = (name, amount) => {
    const key = matchKey(name);
    if (!key || !(amount > 0)) return null;
    const sameAmount = pool.filter(
      (d) => !used.has(d.donationID) && Math.abs(d.amount - amount) < 0.005,
    );
    const exact = sameAmount.filter((d) => matchKey(d.displayName) === key);
    if (exact.length) return exact[0];
    // "Tim" for "Tim Smith", but only when it can't be anyone else.
    const loose = sameAmount.filter((d) => matchKey(d.displayName).startsWith(`${key} `));
    return loose.length === 1 ? loose[0] : null;
  };

  // ---- tally the responses ----------------------------------------------
  const col = locateColumns(responses?.headers ?? []);
  const cell = (row, field) => (col[field] >= 0 ? row[col[field]] ?? '' : '');
  const stats = { total: 0, matched: 0, approved: 0, pending: 0, rejected: 0, noVote: 0 };
  const pending = [];
  let totalTracked = 0;

  const rows = [...(responses?.rows ?? [])].sort(
    (a, b) => (Date.parse(cell(a, 'timestamp')) || 0) - (Date.parse(cell(b, 'timestamp')) || 0),
  );

  /** Which incentive "Which Incentive?" names: 'party', 'league', or null for both. */
  const chosen = (value) => {
    const key = ` ${matchKey(value)} `;
    const names = (words) => (words ?? []).map(matchKey).some((w) => w && key.includes(` ${w} `));
    const party = names(cfg.party.choice);
    const league = names(cfg.league.choice);
    return party === league ? null : party ? 'party' : 'league';
  };

  for (const row of rows) {
    const name = cell(row, 'name');
    const typed = parseAmount(cell(row, 'amount'));
    // A checkbox column fills every row with FALSE, so skip rows with no answers.
    if (!cell(row, 'timestamp') && !name && !typed) continue;
    stats.total += 1;

    const approvedCell = cell(row, 'approved');
    const choice = chosen(cell(row, 'incentive'));
    const vote = choice === 'league' ? null : partyVote(cell(row, 'party'));
    const pick = choice === 'party' ? '' : cell(row, 'league');

    if (!vote && !matchKey(pick)) {
      stats.noVote += 1;
      continue;
    }
    if (isRejected(approvedCell)) {
      stats.rejected += 1;
      continue;
    }

    const donation = matchDonation(name, typed);
    let amount = 0;
    let source = '';
    if (donation) {
      used.add(donation.donationID);
      amount = donation.amount;
      source = 'matched';
    } else if (isTruthy(approvedCell) && typed > 0) {
      amount = typed;
      source = 'approved';
    }

    if (!amount) {
      stats.pending += 1;
      pending.push({ name, amount: typed });
      continue;
    }

    stats[source] += 1;
    totalTracked += amount;
    const contribution = {
      source,
      amount,
      donorName: donation?.displayName || name || 'Anonymous',
      donationId: donation?.donationID ?? null,
      at: donation?.createdAt ?? (Date.parse(cell(row, 'timestamp')) || 0),
    };
    for (const node of [vote, leaguePick(pick)]) {
      if (!node) continue;
      node.raised += amount;
      node.contributions.push(contribution);
    }
  }

  // ---- assemble ----------------------------------------------------------
  for (const node of nodes.values()) {
    if (node.spellings) {
      let best = 0;
      for (const [spelling, count] of node.spellings) {
        if (count > best) {
          best = count;
          node.title = spelling;
        }
      }
      delete node.spellings;
    }
    if (node.parentId) nodes.get(node.parentId).children.push(node);
  }

  const bySort = (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
  const byRaised = (a, b) => b.raised - a.raised || bySort(a, b);
  for (const war of [party, league]) {
    war.children.sort(byRaised);
    war.children.forEach((child, i) => {
      child.rank = i + 1;
    });
    war.raised = war.children.reduce((sum, child) => sum + child.raised, 0);
  }
  for (const node of nodes.values()) {
    node.contributions.sort((a, b) => b.at - a.at);
    node.pct = null;
    node.met = false;
    node.remaining = 0;
  }

  const top = [party, league];
  return { all: nodes, top, active: top, stats, pending, totalTracked };
}

/** Fetches the responses and tallies them. Null when no sheet is set. */
export async function loadIncentives(donations) {
  if (!isIncentivesConfigured()) return null;
  return buildIncentives(await fetchResponses(), donations);
}

/** Look up one incentive by id, including bid war options. */
export function findIncentive(model, id) {
  return model.all.get(String(id ?? '').trim()) ?? null;
}

/**
 * The leading option of a bid war, or null when nothing has been bid yet.
 * `tied` lists everyone sharing first place when there is a tie.
 */
export function bidWarLeader(node) {
  const children = (node?.children ?? []).filter((c) => c.active && c.raised > 0);
  if (!children.length) return null;
  const [first] = children;
  const tied = children.filter((c) => c.raised === first.raised);
  return { option: first, amount: first.raised, tied: tied.length > 1 ? tied : null };
}
