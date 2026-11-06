/** Shared formatting and rendering helpers. */
import { CONFIG } from './config.js';

export function money(value, { cents = false } = {}) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CONFIG.currency,
    minimumFractionDigits: cents || n % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: cents || n % 1 !== 0 ? 2 : 0,
  }).format(n);
}

export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "4 minutes ago" for recent things, falling back to a date for older ones. */
export function relativeTime(epochMs) {
  if (!epochMs) return '';
  const diff = Date.now() - epochMs;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.timezone,
    month: 'short',
    day: 'numeric',
  }).format(epochMs);
}

/** Escapes text before it goes anywhere near innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Makes `target`'s children match `source`'s, changing only what differs, so
 * a refresh with the same results leaves the page untouched: entry animations
 * don't replay and progress bars glide instead of jumping.
 *
 * Elements with a `data-key` are matched by key, so a new ticker row slides
 * in on its own while the existing rows stay put. Other nodes are matched by
 * position and tag. `source` is consumed: new nodes are moved out of it.
 */
export function morphChildren(target, source) {
  const keyOf = (node) => (node.nodeType === 1 ? node.dataset.key ?? null : null);
  const keyed = new Map();
  for (const child of target.childNodes) {
    const key = keyOf(child);
    if (key !== null) keyed.set(key, child);
  }

  let cursor = target.firstChild;
  for (const next of [...source.childNodes]) {
    const key = keyOf(next);
    let match = null;
    if (key !== null) {
      match = keyed.get(key) ?? null;
      keyed.delete(key);
    } else if (
      cursor &&
      keyOf(cursor) === null &&
      cursor.nodeType === next.nodeType &&
      cursor.nodeName === next.nodeName
    ) {
      match = cursor;
    }

    if (!match) {
      target.insertBefore(next, cursor);
      continue;
    }
    if (match === cursor) cursor = cursor.nextSibling;
    else target.insertBefore(match, cursor);
    morphNode(match, next);
  }

  // Whatever is left after the cursor wasn't wanted.
  while (cursor) {
    const after = cursor.nextSibling;
    target.removeChild(cursor);
    cursor = after;
  }
}

function morphNode(target, source) {
  if (target.nodeType !== 1) {
    if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
    return;
  }
  for (const { name, value } of [...source.attributes]) {
    if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  }
  for (const { name } of [...target.attributes]) {
    if (!source.hasAttribute(name)) target.removeAttribute(name);
  }
  morphChildren(target, source);
}

/**
 * Render a leaderboard into an <ol>.
 * Rows come from leaderboard.aggregate().
 */
export function renderBoard(list, rows, { emptyMessage = 'No donations yet.' } = {}) {
  clear(list);

  if (!rows.length) {
    list.append(el('li', 'empty', emptyMessage));
    return;
  }

  for (const row of rows) {
    const li = el('li', `board__row board__row--${row.rank}`);
    if (row.anonymous) li.classList.add('board__row--anon');

    li.append(el('span', 'board__rank', String(row.rank)));

    const avatar = document.createElement('img');
    avatar.className = 'board__avatar';
    avatar.loading = 'lazy';
    avatar.alt = '';
    avatar.src = row.avatarUrl || 'assets/img/avatar-fallback.png';
    avatar.addEventListener('error', () => { avatar.src = 'assets/img/avatar-fallback.png'; }, { once: true });
    li.append(avatar);

    const name = el('span', 'board__name', row.name);
    if (row.count > 1) {
      name.append(el('span', 'board__sub', ` · ${plural(row.count, 'donation')}`));
    }
    li.append(name);

    li.append(el('span', 'board__amount', money(row.total)));
    list.append(li);
  }
}

/** Sets a progress bar's width and its accessible value. */
export function setProgress(fill, pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  fill.style.width = `${clamped}%`;
  const bar = fill.parentElement;
  if (bar) {
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', clamped.toFixed(0));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
  }
}

/**
 * Runs `task` now and then on an interval, skipping ticks while the tab is
 * hidden so a backgrounded OBS source or forgotten tab stops making requests.
 */
export function poll(task, seconds) {
  let timer = null;
  const tick = async () => {
    if (!document.hidden) {
      try {
        await task();
      } catch (err) {
        console.error('[bcl] poll failed', err);
      }
    }
    timer = setTimeout(tick, seconds * 1000);
  };
  tick();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && timer) {
      clearTimeout(timer);
      tick();
    }
  });
  return () => clearTimeout(timer);
}
