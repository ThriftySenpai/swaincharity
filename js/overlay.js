/**
 * OBS browser-source renderer.
 *
 * One page serves every view; `?view=` picks which. Each view declares what
 * data it needs so a "total" overlay never pays for a full donation backfill.
 */
import { CONFIG, applyUrlOverrides } from './config.js';
import { fetchProfile, fetchDonations } from './extralife.js';
import { aggregate, resolveWindow } from './leaderboard.js';
import { loadIncentives, findIncentive } from './incentives.js';
import { money, el, clear, morphChildren, setProgress, poll, relativeTime } from './ui.js';

/**
 * Reads the URL forgivingly. Copy-pasting into OBS easily turns "&" into
 * "&amp;", adds a second "?", or leaves stray spaces and capitals. Read
 * strictly, any of those loses `view=` and quietly shows Top donors instead.
 */
function readParams(search) {
  const cleaned = search.replace(/^\?/, '').replace(/&amp;/gi, '&').replace(/\?/g, '&');
  const out = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(cleaned)) {
    out.set(key.trim().toLowerCase(), value.trim());
  }
  return out;
}

const params = readParams(location.search);
applyUrlOverrides(`?${params}`);
const root = document.getElementById('root');

const view = (params.get('view') || 'top5').toLowerCase();
const windowId = params.get('window') || 'live';
const count = Number(params.get('count')) || CONFIG.leaderboardSize;
const incentiveId = params.get('id') || '';
const customTitle = params.get('title');

// ---------------------------------------------------------------- chrome

const scale = Number(params.get('scale'));
if (Number.isFinite(scale) && scale > 0) {
  document.documentElement.style.fontSize = `${16 * scale}px`;
}

const chroma = params.get('chroma');
if (chroma) {
  document.body.dataset.chroma = 'true';
  document.body.style.background = `#${chroma.replace(/^#/, '')}`;
}

function heading(defaultText, subtitle) {
  const h = el('div', 'ov__title');
  h.append(document.createTextNode(customTitle ?? defaultText));
  if (subtitle) h.append(el('span', 'ov__subtitle', subtitle));
  return h;
}

function showError(message) {
  clear(root);
  root.append(el('div', 'ov-error', message));
}

// ----------------------------------------------------------------- views

function renderBoardRows(rows, emptyText) {
  const list = el('ol', 'ov-board');
  if (!rows.length) {
    list.append(el('li', 'ov-empty', emptyText));
    return list;
  }
  for (const row of rows) {
    const li = el('li', `ov-row ov-row--${row.rank}`);
    li.dataset.key = row.key;
    li.append(el('span', 'ov-row__rank', String(row.rank)));

    const name = el('span', 'ov-row__name', row.name);
    if (row.count > 1) name.append(el('span', 'ov-row__count', `x${row.count}`));
    li.append(name);

    li.append(el('span', 'ov-row__amount', money(row.total)));
    list.append(li);
  }
  return list;
}

const views = {
  /** Top donors for a window, or all-time when window=alltime. */
  top5: {
    needs: { donations: true },
    render({ donations }, out) {
      const window_ = resolveWindow(windowId);
      const { rows } = aggregate(donations, window_, { size: count });
      out.append(heading('Top donors', window_.label));
      out.append(renderBoardRows(rows, 'No donations yet'));
    },
  },

  /** Raised versus goal. */
  total: {
    needs: { profile: true },
    render({ profile }, out) {
      out.append(heading('Raised'));
      out.append(el('div', 'ov-total', money(profile.sumDonations)));
      if (profile.fundraisingGoal > 0) {
        const pct = (profile.sumDonations / profile.fundraisingGoal) * 100;
        out.append(el('div', 'ov-total__goal', `of ${money(profile.fundraisingGoal)} goal`));
        const bar = el('div', 'ov-progress');
        const fill = el('div', 'ov-progress__fill');
        bar.append(fill);
        out.append(bar);
        setProgress(fill, pct);
      }
    },
  },

  /** A single goal-style incentive's progress bar. */
  incentive: {
    needs: { donations: true, sheet: true },
    render({ model }, out) {
      const node = findIncentive(model, incentiveId);
      if (!node) {
        showError(`No incentive with id "${incentiveId}"`);
        return;
      }
      out.append(heading(node.title, node.description || undefined));
      const figures = el('div', 'ov-incentive__figures');
      figures.append(el('span', null, money(node.raised)));
      if (node.target > 0) figures.append(el('span', null, `of ${money(node.target)}`));
      out.append(figures);
      if (node.target > 0) {
        const bar = el('div', 'ov-progress');
        const fill = el('div', 'ov-progress__fill');
        bar.append(fill);
        out.append(bar);
        setProgress(fill, node.pct ?? 0);
      }
    },
  },

  /** A bid war's options, ranked. */
  bidwar: {
    needs: { donations: true, sheet: true },
    render({ model }, out) {
      const node = findIncentive(model, incentiveId);
      if (!node) {
        showError(`No incentive with id "${incentiveId}"`);
        return;
      }
      out.append(heading(node.title, money(node.raised)));
      const list = el('ul', 'ov-bidwar');
      const children = node.children.slice(0, count);
      if (!children.length) {
        list.append(el('li', 'ov-empty', 'No options yet'));
      }
      const max = Math.max(...children.map((c) => c.raised), 1);
      for (const child of children) {
        const li = el('li', `ov-bidwar__row ov-bidwar__row--${child.rank}`);
        li.dataset.key = child.id;
        const head = el('div', 'ov-bidwar__head');
        head.append(el('span', null, child.title));
        head.append(el('span', null, money(child.raised)));
        li.append(head);
        const bar = el('div', 'ov-progress');
        const fill = el('div', 'ov-progress__fill');
        bar.append(fill);
        li.append(bar);
        setProgress(fill, (child.raised / max) * 100);
        list.append(li);
      }
      out.append(list);
    },
  },

  /** Most recent donations. */
  ticker: {
    needs: { donations: true },
    render({ donations }, out) {
      out.append(heading('Recent donations'));
      const list = el('ul', 'ov-ticker');
      const recent = donations.slice(0, count);
      if (!recent.length) {
        list.append(el('li', 'ov-empty', 'No donations yet'));
      }
      for (const d of recent) {
        const li = el('li', 'ov-ticker__row');
        li.dataset.key = d.donationID ?? `${d.createdAt}|${d.displayName}|${d.amount}`;
        const line = el('div');
        line.append(el('span', 'ov-ticker__name', d.displayName || 'Anonymous'));
        line.append(document.createTextNode(` — ${money(d.amount ?? 0)}`));
        line.append(el('span', 'ov-row__count', ` ${relativeTime(d.createdAt)}`));
        li.append(line);
        if (d.message) li.append(el('span', 'ov-ticker__msg', d.message));
        list.append(li);
      }
      out.append(list);
    },
  },
};

// ------------------------------------------------------------------ boot

const active = views[view];

if (!active) {
  showError(`Unknown view "${view}". Try top5, total, incentive, bidwar or ticker.`);
} else {
  const data = {};

  const refresh = async () => {
    const { needs } = active;
    const jobs = [];
    if (needs.profile) jobs.push(fetchProfile().then((p) => { data.profile = p; }));
    if (needs.donations) jobs.push(fetchDonations().then((d) => { data.donations = d; }));
    await Promise.all(jobs);

    if (needs.sheet) {
      data.model = await loadIncentives(data.donations ?? []);
      if (!data.model) {
        showError('Saturday incentives are not connected yet (saturday.sheetId in js/config.js)');
        return;
      }
    }

    // Draw off-screen, then change only what differs, so an unchanged
    // refresh doesn't replay the entry animations. A view that hit a problem
    // has already shown its error and draws nothing here.
    const stage = document.createElement('div');
    active.render(data, stage);
    if (stage.childNodes.length) morphChildren(root, stage);
  };

  // Never poll faster than 20s, however the URL is configured.
  const seconds = Math.max(20, CONFIG.poll.donationsSeconds);

  poll(async () => {
    try {
      await refresh();
    } catch (err) {
      console.error('[bcl overlay]', err);
      if (!root.childElementCount) showError(err.message ?? 'Failed to load');
    }
  }, seconds);
}
