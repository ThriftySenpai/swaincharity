/**
 * Between-games slideshow (slides.html).
 *
 * Rotates the images listed in CONFIG.slideshow.slides, skipping any slide
 * whose `days` don't include today's stream day, and prints the top donor's
 * license-plate text from the Google Sheet onto the plate slide.
 */
import { CONFIG } from './config.js';

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

  stage.append(el);
  return { ...slide, el };
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

/** Reads one cell of a CSV row: strips the quotes and un-doubles "" escapes. */
function parseCsvCell(csv) {
  const line = csv.trim();
  if (line.startsWith('"')) {
    const end = line.lastIndexOf('"');
    return line.slice(1, end > 0 ? end : undefined).replace(/""/g, '"');
  }
  return line.split(',')[0] ?? '';
}

async function refreshPlate() {
  if (!plateText || !PLATE?.sheetId) return;
  const url = new URL(`https://docs.google.com/spreadsheets/d/${PLATE.sheetId}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('headers', '0');
  url.searchParams.set('sheet', PLATE.tab);
  url.searchParams.set('range', PLATE.cell);
  url.searchParams.set('_', String(Date.now()));

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    // A sheet that isn't link-shared answers with a sign-in page, not CSV.
    if (/^\s*</.test(body)) throw new Error('sheet is not shared publicly');
    const text = parseCsvCell(body).trim();
    if (text !== plateText.textContent) {
      plateText.textContent = text;
      fitPlate();
    }
  } catch (err) {
    // Keep showing the last good text; the next poll will try again.
    console.warn('License plate text could not be read:', err.message);
  }
}

async function loadPlateFont() {
  if (!PLATE?.font) return;
  try {
    const face = new FontFace('BCL Plate', `url("${PLATE.font}")`);
    document.fonts.add(await face.load());
    stage.style.setProperty('--plate-font', "'BCL Plate'");
  } catch (err) {
    console.warn('License plate font could not be loaded:', err.message);
  }
}

if (plateText) {
  loadPlateFont().then(() => document.fonts.ready).then(fitPlate);
  refreshPlate();
  setInterval(refreshPlate, (PLATE.refreshSeconds || 30) * 1000);
}
