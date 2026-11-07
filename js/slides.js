/**
 * Between-games slideshow (slides.html).
 *
 * Rotates the images listed in CONFIG.slideshow.slides, skipping any slide
 * whose `days` don't include today's stream day, prints the top donor's
 * license-plate text from the Google Sheet onto the plate slide, and lays a
 * live top-N leaderboard over any slide with a `bidwar` id.
 */
import { CONFIG } from './config.js';
import { fetchPlateText, loadPlateFont } from './plate.js';
import { fetchDonations } from './extralife.js';
import { isIncentivesConfigured, loadIncentives, findIncentive } from './incentives.js';
import { money, el as make, clear, poll } from './ui.js';

// Bid war votes are matched against the whole team's donations, the same as
// the bottom bar, not the site-wide `scope`.
CONFIG.scope = CONFIG.donationBar.scope;
CONFIG.id = CONFIG.donationBar.id;

const SHOW = CONFIG.slideshow;
const params = new URLSearchParams(window.location.search);
const stage = document.getElementById('stage');

const seconds = Number(params.get('seconds')) || SHOW.seconds;
stage.style.setProperty('--fade', `${SHOW.fadeMs}ms`);

// ---- Fit the 1920 x 1080 stage to the source ------------------------------
function fitStage() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.setProperty('--scale', String(scale));
}
window.addEventListener('resize', fitStage);
fitStage();

// ---- Stream day -----------------------------------------------------------
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseDayOverride(value) {
  if (value == null || value === '') return null;
  if (/^[0-6]$/.test(value)) return Number(value);
  const i = DAY_NAMES.indexOf(value.slice(0, 3).toLowerCase());
  return i === -1 ? null : i;
}
const dayOverride = parseDayOverride(params.get('day'));

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, weekday: 'short' });

/**
 * The stream day, 0 = Sunday. Before `dayRolloverHour` it is still the
 * previous day, so a Friday stream that runs to 1:30am keeps Friday's slides.
 */
function streamDay(now = Date.now()) {
  if (dayOverride !== null) return dayOverride;
  const shifted = new Date(now - SHOW.dayRolloverHour * 3600 * 1000);
  return DAY_NAMES.indexOf(weekdayFmt.format(shifted).slice(0, 3).toLowerCase());
}

function isEligible(slide, day) {
  return !Array.isArray(slide.days) || slide.days.includes(day);
}

// ---- Bid war leaderboard ----------------------------------------------------
const BOARD_SIZE = SHOW.bidwarTop || 5;
const DEMO = params.get('demo') === '1';

/** The empty panel; rows are filled in by renderBoard(). */
function buildBoard() {
  const root = make('div', 'board');
  root.append(make('p', 'board__kicker', `Leaderboard`));
  const list = make('ol', 'board__list');
  root.append(list);
  return { root, list };
}

/** Fills one board from a bid war node built by incentives.js. */
function renderBoard(board, war) {
  const picks = (war?.children ?? []).filter((c) => c.raised > 0).slice(0, BOARD_SIZE);
  clear(board.list);
  board.root.classList.toggle('board--empty', !picks.length);

  if (!picks.length) {
    board.list.append(make('li', 'board__empty', 'No candidates yet. Be the first!'));
  }
  const top = picks[0]?.raised || 1;
  picks.forEach((pick, i) => {
    const row = make('li', 'board__row');
    row.style.setProperty('--share', `${Math.max(4, (pick.raised / top) * 100)}%`);
    // Equal totals share a rank, so a tie for first shows two #1s.
    const rank = i > 0 && pick.raised === picks[i - 1].raised
      ? board.list.lastElementChild.dataset.rank
      : String(i + 1);
    row.dataset.rank = rank;
    row.append(
      make('span', 'board__rank', rank),
      make('span', 'board__name', pick.title),
      make('span', 'board__amount', money(pick.raised)),
    );
    board.list.append(row);
  });
}

/** Made-up standings for ?demo=1, to check the layout before votes come in. */
function demoWar() {
  const names = ['Sauron', 'The Witch-king of Angmar', 'Saruman the White', 'Shelob', 'Gollum', 'Smaug'];
  return { children: names.map((title, i) => ({ title, raised: [250, 175, 175, 60, 25, 10][i] })) };
}

// ---- Build the slides ------------------------------------------------------
let plateText = null;

const slides = SHOW.slides.map((slide) => {
  const el = document.createElement('section');
  el.className = 'slide';
  const img = document.createElement('img');
  img.src = SHOW.folder + slide.file;
  img.alt = '';
  img.decoding = 'async';
  el.append(img);

  if (slide.plate) {
    const plate = document.createElement('div');
    plate.className = 'plate';
    plateText = document.createElement('span');
    plateText.className = 'plate__text';
    plate.append(plateText);
    el.append(plate);
  }

  let board = null;
  if (slide.bidwar) {
    board = buildBoard();
    el.append(board.root);
  }

  stage.append(el);
  return { ...slide, el, board };
});

// ---- Rotation ---------------------------------------------------------------
let current = -1;

/** The next slide allowed today, in config order, after `from`. */
function nextIndex(from) {
  const day = streamDay();
  for (let step = 1; step <= slides.length; step += 1) {
    const i = (from + step + slides.length) % slides.length;
    if (isEligible(slides[i], day)) return i;
  }
  return -1;
}

function show(i) {
  if (i === current) return;
  slides[current]?.el.classList.remove('is-active');
  current = i;
  slides[current]?.el.classList.add('is-active');
}

const startAt = params.get('start');
const firstIndex = startAt ? slides.findIndex((s) => s.file.includes(startAt)) : -1;
show(firstIndex !== -1 && isEligible(slides[firstIndex], streamDay()) ? firstIndex : nextIndex(-1));
setInterval(() => show(nextIndex(current)), seconds * 1000);

// ---- License plate ----------------------------------------------------------
const PLATE = SHOW.plate;
const PLATE_MAX_WIDTH = 1380; // inside the 1470px plate box, clear of the bolt holes
const PLATE_FONT_SIZE = 340;

function fitPlate() {
  if (!plateText) return;
  plateText.style.fontSize = `${PLATE_FONT_SIZE}px`;
  const width = plateText.scrollWidth;
  if (width > PLATE_MAX_WIDTH) {
    plateText.style.fontSize = `${Math.floor((PLATE_FONT_SIZE * PLATE_MAX_WIDTH) / width)}px`;
  }
}

async function refreshPlate() {
  if (!plateText || !PLATE?.sheetId) return;
  try {
    const text = await fetchPlateText(PLATE);
    if (text !== plateText.textContent) {
      plateText.textContent = text;
      fitPlate();
    }
  } catch (err) {
    // Keep showing the last good text; the next poll will try again.
    console.warn('License plate text could not be read:', err.message);
  }
}

if (plateText) {
  loadPlateFont(PLATE, stage).then(() => document.fonts.ready).then(fitPlate);
  refreshPlate();
  setInterval(refreshPlate, (PLATE.refreshSeconds || 30) * 1000);
}

// ---- Bid war leaderboards ---------------------------------------------------
const boardSlides = slides.filter((s) => s.board);

async function refreshBoards() {
  // Only read the sheet on days a leaderboard slide is actually in rotation.
  const day = streamDay();
  const live = boardSlides.filter((s) => isEligible(s, day));
  if (!live.length) return;

  if (DEMO) {
    for (const s of live) renderBoard(s.board, demoWar());
    return;
  }
  if (!isIncentivesConfigured()) return;

  // Donations let incentives.js swap a vote's typed amount for the real one.
  // A failed read keeps the last good standings on screen.
  try {
    const donations = await fetchDonations().catch((err) => {
      console.warn('Donations could not be read; using typed amounts:', err.message);
      return [];
    });
    const model = await loadIncentives(donations);
    for (const s of live) renderBoard(s.board, findIncentive(model, s.bidwar));
  } catch (err) {
    console.warn('Bid war standings could not be read:', err.message);
  }
}

if (boardSlides.length) {
  for (const s of boardSlides) renderBoard(s.board, null);
  poll(refreshBoards, Math.max(20, CONFIG.poll.sheetSeconds));
}
